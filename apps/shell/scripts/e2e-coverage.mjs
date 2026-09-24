// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Combined shell coverage (`just shell-e2e-coverage`): the unit run's
// coverage-final.json plus the renderer E2E run's raw V8 coverage, mapped back
// to source through the coverage build's source maps with the same converter
// Vitest uses (ast-v8-to-istanbul).
//
// Only LINES are combined and gated. The two runs instrument different code
// for the same file (Vitest transforms each module, the E2E run executes the
// bundle), so their statement, branch and function maps do not line up and a
// union would count those twice. Line coverage is keyed by source line, so it
// merges cleanly.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { convert } from 'ast-v8-to-istanbul'
import { createCoverageMap } from '@vitest/istanbul-lib-coverage'
import { parseAstAsync } from 'vite'

const SHELL = join(import.meta.dirname, '..')
const OUT = join(SHELL, 'out')
const UNIT = join(SHELL, 'coverage', 'coverage-final.json')
const RAW = process.env.IBLIS_E2E_COVERAGE ?? join(SHELL, 'coverage', 'e2e')

// Same scope as vitest.config.mts coverage.include.
const INCLUDE = [/^electron\/.+\.ts$/, /^src\/.+\.(ts|svelte)$/, /^shared\/.+\.ts$/]

const AREAS = {
  total: () => true,
  'electron/main': (path) => path.startsWith('electron/main/'),
  src: (path) => path.startsWith('src/'),
  shared: (path) => path.startsWith('shared/')
}

// Combined line floors. docs/quality/baseline-2026-09.md records how they
// were set; raise them as tests land, never lower.
const FLOORS = { total: 62, 'electron/main': 74, src: 47, shared: 80 }

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// Every ScriptCoverage from both channels: CDP dumps (renderer + preload) and
// NODE_V8_COVERAGE files (main process and its worker threads).
function rawScripts() {
  const scripts = []
  for (const channel of ['renderer', 'main']) {
    const dir = join(RAW, channel)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.json')) scripts.push(...readJson(join(dir, name)).result)
    }
  }
  return scripts
}

// Bundle files under out/ that carry a source map; everything else (Electron
// internals, node_modules, the fixture sidecar) is outside the shell's scope.
function bundlePath(url) {
  const path = url.startsWith('file:') ? fileURLToPath(url) : url
  return path.startsWith(OUT) && existsSync(`${path}.map`) ? path : null
}

const inScope = (path) => INCLUDE.some((pattern) => pattern.test(relative(SHELL, path)))

async function e2eMap() {
  const map = createCoverageMap({})
  const bundles = new Map()
  for (const script of rawScripts()) {
    const path = bundlePath(script.url)
    if (!path) continue
    if (!bundles.has(path)) {
      const code = readFileSync(path, 'utf8')
      bundles.set(path, { code, ast: await parseAstAsync(code), map: readJson(`${path}.map`) })
    }
    const bundle = bundles.get(path)
    const data = await convert({
      ast: bundle.ast,
      code: bundle.code,
      wrapperLength: 0,
      coverage: { ...script, url: pathToFileURL(path).href },
      sourceMap: bundle.map
    })
    for (const [file, coverage] of Object.entries(data)) {
      if (inScope(file)) map.merge({ [file]: coverage })
    }
  }
  return map
}

// Line totals per area. `files` fixes the universe (every in-scope file the
// unit run reported, loaded or not) so each column shares one denominator.
function lineSummary(map, files) {
  const result = {}
  for (const [area, matches] of Object.entries(AREAS)) {
    let total = 0
    let covered = 0
    for (const file of files) {
      if (!matches(relative(SHELL, file))) continue
      const lines = map.data[file] ? map.fileCoverageFor(file).getLineCoverage() : {}
      for (const hits of Object.values(lines)) {
        total += 1
        if (hits > 0) covered += 1
      }
    }
    result[area] = {
      total,
      covered,
      pct: total ? Math.round((covered / total) * 10000) / 100 : 100
    }
  }
  return result
}

async function main() {
  if (!existsSync(UNIT)) throw new Error(`no unit coverage at ${UNIT}; run the unit coverage first`)
  const unit = createCoverageMap(readJson(UNIT))
  const e2e = await e2eMap()
  if (e2e.files().length === 0) throw new Error(`no E2E coverage mapped from ${RAW}`)

  // One line universe for every column: unit and E2E each report lines the
  // other lacks (different generated code), and a file only one side loaded
  // still counts wholly. A column is that universe, zeroed, plus its own hits.
  // Maps share data objects, hence the JSON round trip for each copy.
  const clone = (map) => createCoverageMap(JSON.parse(JSON.stringify(map.toJSON())))
  const universe = clone(unit)
  universe.merge(e2e)
  const files = universe.files()
  for (const file of files) {
    const coverage = universe.fileCoverageFor(file)
    for (const key of Object.keys(coverage.s)) coverage.s[key] = 0
  }
  const column = (...maps) => {
    const result = clone(universe)
    for (const map of maps) result.merge(clone(map))
    return result
  }

  const report = {
    unit: lineSummary(column(unit), files),
    e2e: lineSummary(column(e2e), files),
    combined: lineSummary(column(unit, e2e), files)
  }
  writeFileSync(
    join(SHELL, 'coverage', 'combined-summary.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )

  console.log('Shell line coverage (unit / E2E / combined):')
  const failures = []
  for (const area of Object.keys(AREAS)) {
    const row = [report.unit, report.e2e, report.combined].map((r) => `${r[area].pct.toFixed(2)}%`)
    console.log(`  ${area.padEnd(14)} ${row.join('  ')}  (${report.combined[area].total} lines)`)
    if (report.combined[area].pct < FLOORS[area]) {
      failures.push(`${area}: ${report.combined[area].pct}% < floor ${FLOORS[area]}%`)
    }
  }
  if (failures.length > 0) {
    console.error(`Combined line coverage below floor:\n  ${failures.join('\n  ')}`)
    process.exit(1)
  }
}

await main()
