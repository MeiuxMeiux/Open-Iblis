// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import {
  EVALUATION_DISTRIBUTIONS,
  EVALUATION_STATUSES,
  isPluginKind,
  type AssetSourceKind,
  type EvaluationDistribution,
  type EvaluationStatus,
  type PluginManifest
} from './manifest.js'
import { trimmedByWindows } from './internal.js'
import { isSlotId } from './slots.js'
import { CATALOG_SCHEMA_VERSION, type Catalog, type CatalogEntry } from './catalog.js'
import { isSkinToken, type SkinDescriptor, type SkinTokens } from './skin-contract.js'

// Runtime validation for untrusted JSON crossing the trust boundary (catalog
// entries and plugin manifests). Even though the catalog is Ed25519-signed,
// the bytes are still parsed defensively: a valid signature on malformed JSON
// must not crash the host. All validators accumulate human-readable errors
// rather than throwing.

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/
// reverse-DNS-ish: at least two dot-separated lowercase segments.
const PLUGIN_ID = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/
const ASSET_SOURCE_KINDS: readonly AssetSourceKind[] = ['vendor', 'gcs', 'bundled']

class Errors {
  readonly list: string[] = []
  add(path: string, msg: string): void {
    this.list.push(`${path}: ${msg}`)
  }
  get ok(): boolean {
    return this.list.length === 0
  }
}

function checkString(e: Errors, o: Record<string, unknown>, key: string, path: string): void {
  if (!isString(o[key]) || o[key] === '') e.add(`${path}.${key}`, 'expected a non-empty string')
}

// A manifest field that becomes a file path under the plugin's version folder
// (asset write target, slot entry, executable bin). Even though the catalog is
// signed, the value is treated as untrusted: it must be a relative path that
// stays inside the folder, so a compromised/malicious manifest cannot direct a
// write or a spawn outside the plugin dir. Rejects absolute paths, Windows
// drive/UNC paths, backslashes, NUL, and any `..` segment. The installer
// re-checks containment as defense in depth.
function checkRelPath(e: Errors, o: Record<string, unknown>, key: string, path: string): void {
  const v = o[key]
  if (!isString(v) || v === '') {
    e.add(`${path}.${key}`, 'expected a non-empty string')
    return
  }
  const unsafe =
    v.includes('\\') || // backslash: Windows separator / UNC lead
    v.includes('\0') || // NUL byte
    v.includes(':') || // Windows drive (C:...) or NTFS stream (file:stream)
    v.startsWith('/') || // POSIX absolute
    v.split('/').some((seg) => seg === '..' || trimmedByWindows(seg)) // parent-dir escape
  if (unsafe) {
    e.add(
      `${path}.${key}`,
      'expected a relative path inside the plugin folder (no "..", absolute, drive, or UNC paths)'
    )
  }
}

function checkSemver(e: Errors, o: Record<string, unknown>, key: string, path: string): void {
  const v = o[key]
  if (!isString(v) || !SEMVER.test(v)) e.add(`${path}.${key}`, 'expected a SemVer string')
}

function checkOptionalString(
  e: Errors,
  o: Record<string, unknown>,
  key: string,
  path: string
): void {
  if (key in o && !isString(o[key])) e.add(`${path}.${key}`, 'expected a string')
}

function validateAssetSource(e: Errors, v: unknown, path: string): void {
  if (!isObject(v)) {
    e.add(path, 'expected an object')
    return
  }
  if (!isString(v.url) || !/^https:\/\//i.test(v.url)) {
    e.add(`${path}.url`, 'expected an https:// URL')
  }
  if (!isString(v.kind) || !ASSET_SOURCE_KINDS.includes(v.kind as AssetSourceKind)) {
    e.add(`${path}.kind`, `expected one of ${ASSET_SOURCE_KINDS.join(', ')}`)
  }
}

function validateAsset(e: Errors, v: unknown, path: string): void {
  if (!isObject(v)) {
    e.add(path, 'expected an object')
    return
  }
  checkRelPath(e, v, 'path', path)
  if (!isString(v.sha256) || !SHA256.test(v.sha256)) {
    e.add(`${path}.sha256`, 'expected a lowercase hex SHA-256 (64 chars)')
  }
  if (!isFiniteNumber(v.bytes) || v.bytes < 0) {
    e.add(`${path}.bytes`, 'expected a non-negative number')
  }
  const sources = v.sources
  if (!Array.isArray(sources) || sources.length === 0) {
    e.add(`${path}.sources`, 'expected a non-empty array')
  } else {
    sources.forEach((s, i) => {
      validateAssetSource(e, s, `${path}.sources[${i}]`)
    })
  }
  if ('executable' in v && typeof v.executable !== 'boolean') {
    e.add(`${path}.executable`, 'expected a boolean')
  }
  if ('unpack' in v && v.unpack !== 'zip') {
    e.add(`${path}.unpack`, "expected 'zip'")
  }
}

function validateSlot(e: Errors, v: unknown, path: string): void {
  if (!isObject(v)) {
    e.add(path, 'expected an object')
    return
  }
  if (!isSlotId(v.slot)) e.add(`${path}.slot`, 'unknown slot id')
  checkRelPath(e, v, 'entry', path)
  if ('priority' in v && !isFiniteNumber(v.priority)) {
    e.add(`${path}.priority`, 'expected a number')
  }
}

function validateExecutable(e: Errors, v: unknown, path: string): void {
  if (!isObject(v)) {
    e.add(path, 'expected an object')
    return
  }
  checkRelPath(e, v, 'bin', path)
  if ('args' in v && !(Array.isArray(v.args) && v.args.every(isString))) {
    e.add(`${path}.args`, 'expected an array of strings')
  }
  for (const k of ['portArg', 'sessionEnv', 'healthPath'] as const)
    checkOptionalString(e, v, k, path)
  for (const k of ['healthTimeoutMs', 'idleUnloadMinutes'] as const) {
    if (k in v && !isFiniteNumber(v[k])) e.add(`${path}.${k}`, 'expected a number')
  }
}

function validatePreset(e: Errors, v: unknown, path: string): void {
  if (!isObject(v)) {
    e.add(path, 'expected an object')
    return
  }
  checkString(e, v, 'id', path)
  checkString(e, v, 'name', path)
  if (!isFiniteNumber(v.minVramMb)) e.add(`${path}.minVramMb`, 'expected a number')
}

function validateEvaluation(e: Errors, v: unknown, path: string): void {
  if (!isObject(v)) {
    e.add(path, 'expected an object')
    return
  }
  const known = new Set([
    'status',
    'distribution',
    'codeLicense',
    'modelLicense',
    'dependencyLicenses',
    'termsUrl',
    'noticePath',
    'upstreamRevision',
    'acknowledgement',
    'releaseBlocker'
  ])
  for (const key of Object.keys(v)) {
    if (!known.has(key)) e.add(`${path}.${key}`, 'unknown evaluation field')
  }
  if (!isString(v.status) || !EVALUATION_STATUSES.includes(v.status as EvaluationStatus)) {
    e.add(`${path}.status`, `expected one of ${EVALUATION_STATUSES.join(', ')}`)
  }
  if (
    !isString(v.distribution) ||
    !EVALUATION_DISTRIBUTIONS.includes(v.distribution as EvaluationDistribution)
  ) {
    e.add(`${path}.distribution`, `expected one of ${EVALUATION_DISTRIBUTIONS.join(', ')}`)
  }
  for (const key of ['codeLicense', 'termsUrl', 'upstreamRevision', 'acknowledgement'] as const) {
    checkString(e, v, key, path)
  }
  if (!isString(v.termsUrl) || !/^https:\/\//i.test(v.termsUrl)) {
    e.add(`${path}.termsUrl`, 'expected an https:// URL')
  }
  checkRelPath(e, v, 'noticePath', path)
  if (
    !Array.isArray(v.dependencyLicenses) ||
    !v.dependencyLicenses.every((license) => isString(license) && license !== '')
  ) {
    e.add(`${path}.dependencyLicenses`, 'expected an array of non-empty strings')
  }
  for (const key of ['modelLicense', 'releaseBlocker'] as const) {
    if (key in v && (!isString(v[key]) || v[key] === '')) {
      e.add(`${path}.${key}`, 'expected a non-empty string')
    }
  }
}

// The v2 engine section is a closed shape: unknown fields fail so a future
// broadened claim cannot ride into old hosts unvalidated. The descriptor
// asset must be one of the manifest's own hash-verified assets — that is
// what makes the descriptor's bytes signed.
function validateEngineSection(e: Errors, v: unknown, path: string, assets: unknown): void {
  if (!isObject(v)) {
    e.add(path, 'expected an object')
    return
  }
  const allowed = new Set(['protocolVersion', 'descriptorAsset', 'execution', 'adapterIngress'])
  for (const key of Object.keys(v)) {
    if (!allowed.has(key)) e.add(`${path}.${key}`, 'unknown field')
  }
  if (v.protocolVersion !== 2) e.add(`${path}.protocolVersion`, 'expected 2')
  if (v.execution !== 'local-sidecar') e.add(`${path}.execution`, 'expected "local-sidecar"')
  if ('adapterIngress' in v && v.adapterIngress !== 'iblis-root-v1') {
    e.add(`${path}.adapterIngress`, 'expected "iblis-root-v1"')
  }
  checkRelPath(e, v, 'descriptorAsset', path)
  const declared =
    Array.isArray(assets) && assets.some((a) => isObject(a) && a.path === v.descriptorAsset)
  if (isString(v.descriptorAsset) && !declared) {
    e.add(`${path}.descriptorAsset`, 'must name a declared asset path')
  }
}

function isAnalysisProcessor(m: Record<string, unknown>): boolean {
  return (
    m.kind === 'processor' &&
    Array.isArray(m.capabilities) &&
    m.capabilities.some((capability) => capability === 'bpm-detect' || capability === 'key-detect')
  )
}

export function parseManifest(input: unknown, path = 'manifest'): ParseResult<PluginManifest> {
  const e = new Errors()
  if (!isObject(input)) return { ok: false, errors: [`${path}: expected an object`] }
  const m = input

  if (!isString(m.id) || !PLUGIN_ID.test(m.id)) {
    e.add(`${path}.id`, 'expected a reverse-DNS id (e.g. mx.iblis.engine.acestep)')
  }
  checkString(e, m, 'name', path)
  checkSemver(e, m, 'version', path)
  if (!isPluginKind(m.kind)) e.add(`${path}.kind`, 'unknown plugin kind')
  checkSemver(e, m, 'hostMinVersion', path)
  checkString(e, m, 'license', path)

  if (!(Array.isArray(m.capabilities) && m.capabilities.every(isString))) {
    e.add(`${path}.capabilities`, 'expected an array of strings')
  }

  if (!Array.isArray(m.assets)) {
    e.add(`${path}.assets`, 'expected an array')
  } else {
    m.assets.forEach((a, i) => {
      validateAsset(e, a, `${path}.assets[${i}]`)
    })
  }

  const author = m.author
  if (!isObject(author)) {
    e.add(`${path}.author`, 'expected an object')
  } else {
    checkString(e, author, 'name', `${path}.author`)
    checkOptionalString(e, author, 'url', `${path}.author`)
  }

  if ('slots' in m) {
    if (!Array.isArray(m.slots)) e.add(`${path}.slots`, 'expected an array')
    else
      m.slots.forEach((s, i) => {
        validateSlot(e, s, `${path}.slots[${i}]`)
      })
  }
  if ('executable' in m) validateExecutable(e, m.executable, `${path}.executable`)
  if ('presets' in m) {
    if (!Array.isArray(m.presets)) e.add(`${path}.presets`, 'expected an array')
    else
      m.presets.forEach((p, i) => {
        validatePreset(e, p, `${path}.presets[${i}]`)
      })
  }
  if ('configSchema' in m && !isObject(m.configSchema)) {
    e.add(`${path}.configSchema`, 'expected an object')
  }
  if ('cloudProvider' in m) {
    if (!isObject(m.cloudProvider)) e.add(`${path}.cloudProvider`, 'expected an object')
    else if (m.cloudProvider.id !== 'openrouter' && m.cloudProvider.id !== 'imagerouter') {
      e.add(`${path}.cloudProvider.id`, 'expected "openrouter" or "imagerouter"')
    }
  }
  if (m.kind === 'cloud-provider' && !('cloudProvider' in m)) {
    e.add(`${path}.cloudProvider`, 'required for cloud-provider plugins')
  }
  if (m.kind !== 'cloud-provider' && 'cloudProvider' in m) {
    e.add(`${path}.cloudProvider`, 'only allowed for cloud-provider plugins')
  }
  if ('evaluation' in m) {
    if (m.kind !== 'processor') e.add(`${path}.evaluation`, 'only allowed for processor plugins')
    validateEvaluation(e, m.evaluation, `${path}.evaluation`)
  }
  if ('engine' in m) {
    if (m.kind !== 'engine') e.add(`${path}.engine`, 'only allowed for engine plugins')
    validateEngineSection(e, m.engine, `${path}.engine`, m.assets)
  }
  if (isAnalysisProcessor(m) && !('evaluation' in m)) {
    e.add(`${path}.evaluation`, 'required for BPM/key processor plugins')
  }
  checkOptionalString(e, m, 'bugUrl', path)

  if (!e.ok) return { ok: false, errors: e.list }
  return { ok: true, value: input as unknown as PluginManifest }
}

export function parseCatalog(input: unknown): ParseResult<Catalog> {
  const e = new Errors()
  if (!isObject(input)) return { ok: false, errors: ['catalog: expected an object'] }

  if (input.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    e.add('catalog.schemaVersion', `expected ${CATALOG_SCHEMA_VERSION}`)
  }
  if (!isString(input.generatedAt)) e.add('catalog.generatedAt', 'expected an ISO string')

  const plugins = input.plugins
  if (!Array.isArray(plugins)) {
    e.add('catalog.plugins', 'expected an array')
  } else {
    plugins.forEach((entry, i) => {
      const p = `catalog.plugins[${i}]`
      if (!isObject(entry)) {
        e.add(p, 'expected an object')
        return
      }
      const m = parseManifest(entry.manifest, `${p}.manifest`)
      if (!m.ok) e.list.push(...m.errors)
      else validatePublicEvaluation(e, m.value, `${p}.manifest.evaluation`)
      if ('channel' in entry && entry.channel !== 'stable' && entry.channel !== 'beta') {
        e.add(`${p}.channel`, 'expected "stable" or "beta"')
      }
      if ('publishedAt' in entry && !isString(entry.publishedAt)) {
        e.add(`${p}.publishedAt`, 'expected an ISO string')
      }
    })
  }

  if (!e.ok) return { ok: false, errors: e.list }
  return { ok: true, value: input as unknown as Catalog }
}

// The lab feed deliberately has a separate parser rather than a caller flag:
// a signed private-lab manifest must not become valid input to the ordinary
// public installer by accident.
export function parseLabCatalog(input: unknown): ParseResult<Catalog> {
  const e = new Errors()
  if (!isObject(input)) return { ok: false, errors: ['lab catalog: expected an object'] }
  if (input.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    e.add('lab catalog.schemaVersion', `expected ${CATALOG_SCHEMA_VERSION}`)
  }
  if (!isString(input.generatedAt)) e.add('lab catalog.generatedAt', 'expected an ISO string')
  const plugins = input.plugins
  if (!Array.isArray(plugins)) {
    e.add('lab catalog.plugins', 'expected an array')
  } else {
    plugins.forEach((entry, i) => {
      const p = `lab catalog.plugins[${i}]`
      if (!isObject(entry)) {
        e.add(p, 'expected an object')
        return
      }
      const m = parseManifest(entry.manifest, `${p}.manifest`)
      if (!m.ok) e.list.push(...m.errors)
      else validateLabEvaluation(e, m.value, `${p}.manifest.evaluation`)
      if ('channel' in entry && entry.channel !== 'stable' && entry.channel !== 'beta') {
        e.add(`${p}.channel`, 'expected "stable" or "beta"')
      }
      if ('publishedAt' in entry && !isString(entry.publishedAt)) {
        e.add(`${p}.publishedAt`, 'expected an ISO string')
      }
    })
  }
  if (!e.ok) return { ok: false, errors: e.list }
  return { ok: true, value: input as unknown as Catalog }
}

function validatePublicEvaluation(e: Errors, manifest: PluginManifest, path: string): void {
  if (!manifest.evaluation) return
  if (
    manifest.evaluation.status !== 'commercial-candidate' ||
    manifest.evaluation.distribution !== 'public-catalog'
  ) {
    e.add(path, 'restricted processor evaluation metadata is not allowed in the public catalog')
  }
}

function validateLabEvaluation(e: Errors, manifest: PluginManifest, path: string): void {
  if (manifest.kind !== 'processor' || !manifest.evaluation) {
    e.add(path, 'a private lab catalog may contain only evaluated processor plugins')
    return
  }
  if (manifest.evaluation.distribution === 'public-catalog') {
    e.add(path, 'private lab entries must not use the public-catalog distribution')
  }
}

// Convenience: a CatalogEntry guard for callers that already trust the shape.
export const isCatalogEntry = (v: unknown): v is CatalogEntry => isObject(v) && isObject(v.manifest)

const MAX_TOKEN_VALUE_LEN = 200 // token values are short CSS literals

// Keep only contract tokens mapped to short string values. Unknown keys,
// non-strings, and over-long values are dropped (mirrors the shell editor's
// sanitiser, but here at the SDK trust boundary).
function sanitizeSkinTokens(raw: unknown): SkinTokens {
  const clean: SkinTokens = {}
  if (!isObject(raw)) return clean
  for (const [token, value] of Object.entries(raw)) {
    if (isSkinToken(token) && isString(value) && value.length <= MAX_TOKEN_VALUE_LEN) {
      clean[token] = value
    }
  }
  return clean
}

// Parse a skin descriptor (a skin plugin's `skin.json` asset, or a `.iblis-skin`
// file). Untrusted JSON crossing the trust boundary: id/name/version are
// required, `tokens` is filtered to the contract, and at least one valid token
// must survive. Optional `extends`/`theme`/`css` are validated when present.
export function parseSkinDescriptor(input: unknown, path = 'skin'): ParseResult<SkinDescriptor> {
  const e = new Errors()
  if (!isObject(input)) return { ok: false, errors: [`${path}: expected an object`] }

  checkString(e, input, 'id', path)
  checkString(e, input, 'name', path)
  checkSemver(e, input, 'version', path)
  checkOptionalString(e, input, 'extends', path)
  checkOptionalString(e, input, 'css', path)
  if ('theme' in input && input.theme !== 'dark' && input.theme !== 'light') {
    e.add(`${path}.theme`, 'expected "dark" or "light"')
  }

  const tokens = sanitizeSkinTokens(input.tokens)
  if (Object.keys(tokens).length === 0) {
    e.add(`${path}.tokens`, 'expected at least one known SkinContract token')
  }

  if (!e.ok) return { ok: false, errors: e.list }
  const out: SkinDescriptor = {
    id: input.id as string,
    name: input.name as string,
    version: input.version as string,
    tokens
  }
  if (isString(input.extends)) out.extends = input.extends
  if (input.theme === 'dark' || input.theme === 'light') out.theme = input.theme
  if (isString(input.css)) out.css = input.css
  return { ok: true, value: out }
}
