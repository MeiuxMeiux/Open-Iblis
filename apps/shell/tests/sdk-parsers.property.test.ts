// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Property tests for the validators that stand between signed-but-untrusted
// JSON and the host: they must never throw, must say why they refuse, and
// must never accept a path that resolves outside its folder. Seeds are the
// real signed catalog the shell E2E suite serves and the fixture engine's
// v2 descriptor, so mutations start from documents that parse today.
import { readFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  engineOutputPathErrorsV2,
  parseCatalog,
  parseEngineDescriptorV2,
  parseEngineJobOutputsV2,
  parseEngineRecipeV2,
  parseLabCatalog,
  parseBpmDetectionValueV1,
  parseKeyDetectionValueV1,
  parseManifest,
  parseProcessorAnalysisResultsV1,
  parseSkinDescriptor,
  type ParseResult
} from '@iblis/plugin-sdk'

// Default 100 cases per property; IBLIS_FC_RUNS=20000 for a deep local run.
fc.configureGlobal({ numRuns: Number(process.env.IBLIS_FC_RUNS ?? 100) })

const REPO = join(__dirname, '..', '..', '..')
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(REPO, rel), 'utf8'))
const catalog = readJson('apps/shell/e2e/fixtures/catalog.json') as {
  plugins: { manifest: Record<string, unknown> }[]
}
const descriptor = readJson('packages/plugins/fixture-engine/engine.v2.json')

// Every parser in one shape: untrusted input in, ParseResult out.
const parsers: [string, (input: unknown) => ParseResult<unknown>][] = [
  ['parseManifest', (input) => parseManifest(input)],
  ['parseCatalog', parseCatalog],
  ['parseLabCatalog', parseLabCatalog],
  ['parseSkinDescriptor', (input) => parseSkinDescriptor(input)],
  ['parseEngineDescriptorV2', (input) => parseEngineDescriptorV2(input)],
  ['parseEngineRecipeV2', (input) => parseEngineRecipeV2(input)],
  ['parseBpmDetectionValueV1', (input) => parseBpmDetectionValueV1(input)],
  ['parseKeyDetectionValueV1', (input) => parseKeyDetectionValueV1(input)],
  ['parseProcessorAnalysisResultsV1', (input) => parseProcessorAnalysisResultsV1(input)]
]

// fc.anything plus objects whose toString is not callable: String() on
// them throws, which is how a validator that coerces untrusted values fails.
const untrusted = fc.oneof(
  fc.anything(),
  fc.record({ toString: fc.jsonValue({ maxDepth: 1 }) }),
  fc.array(fc.record({ id: fc.record({ toString: fc.constant('') }) }), { maxLength: 3 })
)

function wellFormed(result: ParseResult<unknown>): boolean {
  return (
    result.ok || (result.errors.length > 0 && result.errors.every((e) => typeof e === 'string'))
  )
}

// Replace, delete, or add one field somewhere inside a JSON document.
interface Mutation {
  at: number
  op: 'replace' | 'delete' | 'add'
  value: unknown
}
const mutation: fc.Arbitrary<Mutation> = fc.record({
  at: fc.nat(),
  op: fc.constantFrom('replace', 'delete', 'add'),
  value: fc.jsonValue({ maxDepth: 2 })
})

function containers(
  value: unknown,
  out: Record<string, unknown>[] = []
): Record<string, unknown>[] {
  if (value !== null && typeof value === 'object') {
    out.push(value as Record<string, unknown>)
    for (const child of Object.values(value)) containers(child, out)
  }
  return out
}

function mutate(doc: unknown, m: Mutation): unknown {
  const copy = structuredClone(doc)
  const all = containers(copy)
  const target = all[m.at % all.length]
  if (!target) return m.value
  const keys = Object.keys(target)
  const key = keys[m.at % Math.max(keys.length, 1)] ?? 'extra'
  if (m.op === 'add') target[Array.isArray(target) ? String(keys.length) : `x${m.at}`] = m.value
  else if (m.op === 'delete') Reflect.deleteProperty(target, key)
  else target[key] = m.value
  return copy
}

// Deterministic companion to the mutation properties: every field of every
// seed document, one at a time, replaced by a value String() cannot convert.
function everyFieldTrapped(doc: unknown): unknown[] {
  const out: unknown[] = []
  containers(doc).forEach((_container, index) => {
    const keys = Object.keys(containers(structuredClone(doc))[index] ?? {})
    for (const key of keys) {
      const copy = structuredClone(doc)
      const target = containers(copy)[index]
      if (target) target[key] = { toString: '' }
      out.push(copy)
    }
  })
  return out
}

describe('validators never throw', () => {
  it('on a toString trap in any field of the seed documents', () => {
    for (const doc of everyFieldTrapped(catalog)) expect(wellFormed(parseCatalog(doc))).toBe(true)
    for (const doc of everyFieldTrapped(descriptor)) {
      expect(wellFormed(parseEngineDescriptorV2(doc))).toBe(true)
    }
  })

  it.each(parsers)('%s on arbitrary values', (_name, parse) => {
    fc.assert(fc.property(untrusted, (input) => wellFormed(parse(input))))
  })

  it('parseCatalog on mutations of the signed catalog', () => {
    expect(parseCatalog(catalog).ok).toBe(true)
    fc.assert(fc.property(mutation, (m) => wellFormed(parseCatalog(mutate(catalog, m)))))
  })

  it('parseManifest on mutations of every catalog manifest', () => {
    const manifests = catalog.plugins.map((p) => p.manifest)
    for (const manifest of manifests) expect(parseManifest(manifest).ok).toBe(true)
    fc.assert(
      fc.property(fc.constantFrom(...manifests), mutation, (manifest, m) =>
        wellFormed(parseManifest(mutate(manifest, m)))
      )
    )
  })

  it('parseEngineDescriptorV2 on mutations of the fixture engine', () => {
    expect(parseEngineDescriptorV2(descriptor).ok).toBe(true)
    fc.assert(
      fc.property(mutation, (m) => wellFormed(parseEngineDescriptorV2(mutate(descriptor, m))))
    )
  })
})

// Strings built from the pieces path attacks are made of, plus noise.
const hostilePath = fc.oneof(
  fc
    .array(
      fc.constantFrom(
        '..',
        '.',
        '',
        'a',
        'bin',
        'x.exe',
        'C:',
        'c:',
        '\\',
        '/',
        ' ',
        '\0',
        ':',
        '..\\x',
        '%2e%2e',
        '~',
        '...',
        '.. '
      ),
      { maxLength: 6 }
    )
    .map((parts) => parts.join('/')),
  fc.string({ unit: 'binary', maxLength: 24 })
)

// Inside the folder on both platforms, and no name Win32 would rewrite.
function contained(candidate: string): boolean {
  const inside = (root: string, lib: typeof posix): boolean => {
    const resolved = lib.resolve(root, candidate)
    return resolved === root || resolved.startsWith(root + lib.sep)
  }
  return (
    inside('/root', posix) &&
    inside('C:\\root', win32) &&
    !candidate.split('/').some((segment) => segment !== '.' && /[. ]$/.test(segment))
  )
}

describe('accepted paths stay inside their folder', () => {
  it('engine v2 output paths, on POSIX and Windows', () => {
    fc.assert(
      fc.property(hostilePath, (path) => {
        if (engineOutputPathErrorsV2(path).length > 0) return true
        return contained(path)
      })
    )
  })

  it('manifest asset paths, on POSIX and Windows', () => {
    const base = catalog.plugins[0]?.manifest ?? {}
    fc.assert(
      fc.property(hostilePath, (path) => {
        const manifest = structuredClone(base) as { assets: { path: string }[] }
        const [first] = manifest.assets
        if (!first) return true
        first.path = path
        if (!parseManifest(manifest).ok) return true
        return contained(path)
      })
    )
  })

  it('job outputs never throw on arbitrary entries', () => {
    const parsed = parseEngineDescriptorV2(descriptor)
    if (!parsed.ok) throw new Error('fixture descriptor no longer parses')
    const operation = parsed.value.operations[0]
    if (!operation) throw new Error('fixture descriptor has no operations')
    const entry = fc.record({ role: fc.constantFrom('mix', 'preview', 'stem'), path: untrusted })
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 3 }), (outputs) =>
        wellFormed(parseEngineJobOutputsV2(outputs, operation))
      )
    )
  })

  it('job outputs reject every path the path check rejects', () => {
    const parsed = parseEngineDescriptorV2(descriptor)
    if (!parsed.ok) throw new Error('fixture descriptor no longer parses')
    const operation = parsed.value.operations[0]
    if (!operation) throw new Error('fixture descriptor has no operations')
    fc.assert(
      fc.property(hostilePath, (path) => {
        const result = parseEngineJobOutputsV2([{ role: 'mix', path }], operation)
        return wellFormed(result) && (engineOutputPathErrorsV2(path).length === 0 || !result.ok)
      })
    )
  })
})
