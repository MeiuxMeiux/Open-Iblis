// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The one place the shell learns where Iblis services live.
//
// Two kinds of build exist. The release workflow bakes the build-time define
// IBLIS_OFFICIAL_BUILD=true (electron.vite.config.ts, shell-build.yml): those
// signed installers talk to the official services and auto-update from the
// official feed. Anyone else who clones the source and runs `just build` gets
// a source build (the define defaults to 'false'):
//
// - Update feed: empty. A self-built app never auto-updates onto an official
//   installer. electron-builder still writes app-update.yml into any package,
//   so updater.ts consults updateFeedUrl() before it starts.
// - Hosted services (activation, community uploads, diagnostics, labs): off.
//   serviceEndpoint() returns null and the clients refuse with the stable
//   'not-configured' code before any network call, unless the builder set the
//   matching environment override (IBLIS_KEYS_BASE, IBLIS_TRAININGS_BASE,
//   IBLIS_DIAG_ENDPOINT, IBLIS_LAB_CATALOG_BASE).
// - Read-only public feeds (plugin catalog, community trainings index): the
//   official ones, in every build. They are public, and every byte is
//   signature-checked against the key baked into the app before it is
//   trusted, so a source build browsing them gains nothing it should not have
//   and users of source builds still get plugins. IBLIS_CATALOG_BASE and
//   IBLIS_TRAININGS_INDEX_BASE override them for development and tests.
// - The website (feedback forms, terms links): always the official site.
//
// IBLIS_OFFICIAL_BUILD is read at call time, not module load: in the bundle
// the define turns it into a literal, and unit tests can stub the env.

export const OFFICIAL_SITE_ORIGIN = 'https://iblis.meiuxmeiux.com'
const OFFICIAL_API_ROOT = `${OFFICIAL_SITE_ORIGIN}/api`
const OFFICIAL_DIST = 'https://storage.googleapis.com/iblis-dist'
// Must equal electron-builder.yml publish.url (tests/official-endpoints pins it).
export const OFFICIAL_UPDATE_FEED = `${OFFICIAL_DIST}/shell`

export type BuildKind = 'official' | 'source'
export type ServiceEndpoint = 'keys' | 'trainings' | 'diag' | 'labs'
export type CatalogRoute = 'v1' | 'v2'

export const NOT_CONFIGURED = 'not-configured'

const SERVICES: Record<ServiceEndpoint, { env: string; official: string; refusal: string }> = {
  keys: {
    env: 'IBLIS_KEYS_BASE',
    official: `${OFFICIAL_API_ROOT}/v1/keys`,
    refusal: 'Product key activation is not available in this build.'
  },
  trainings: {
    env: 'IBLIS_TRAININGS_BASE',
    official: `${OFFICIAL_API_ROOT}/v1/trainings`,
    refusal: 'Community uploads are not available in this build.'
  },
  diag: {
    env: 'IBLIS_DIAG_ENDPOINT',
    official: `${OFFICIAL_API_ROOT}/v1/diag.php`,
    refusal: 'Diagnostics uploads are not available in this build.'
  },
  labs: {
    env: 'IBLIS_LAB_CATALOG_BASE',
    official: `${OFFICIAL_API_ROOT}/labs`,
    refusal: 'The processor lab is not available in this build.'
  }
}

// Thrown (or mapped to a result value) when a hosted service has no endpoint
// in this build. `code` is the stable machine-readable form.
export class NotConfiguredError extends Error {
  readonly code = NOT_CONFIGURED
  constructor(service: ServiceEndpoint) {
    super(SERVICES[service].refusal)
    this.name = 'NotConfiguredError'
  }
}

export function isOfficialBuild(): boolean {
  return process.env.IBLIS_OFFICIAL_BUILD === 'true'
}

export function buildKind(): BuildKind {
  return isOfficialBuild() ? 'official' : 'source'
}

function override(name: string): string | null {
  const value = process.env[name]
  return value !== undefined && value !== '' ? value : null
}

// The base URL of a hosted service, or null when this build has none (a
// source build without an override). Callers must not fall back to anything.
export function serviceEndpoint(service: ServiceEndpoint): string | null {
  const spec = SERVICES[service]
  return override(spec.env) ?? (isOfficialBuild() ? spec.official : null)
}

export function requireServiceEndpoint(service: ServiceEndpoint): string {
  const url = serviceEndpoint(service)
  if (url === null) throw new NotConfiguredError(service)
  return url
}

// Signed plugin catalog. The override replaces the whole route base.
export function catalogBase(route: CatalogRoute): string {
  return override('IBLIS_CATALOG_BASE') ?? `${OFFICIAL_API_ROOT}/${route}`
}

// Signed community trainings index (read-only, public).
export function trainingsIndexBase(): string {
  return override('IBLIS_TRAININGS_INDEX_BASE') ?? `${OFFICIAL_DIST}/trainings`
}

// Empty for source builds: updater.ts then never starts. There is
// deliberately no override; a fork that ships updates sets up its own feed
// and its own official-build flag.
export function updateFeedUrl(): string {
  return isOfficialBuild() ? OFFICIAL_UPDATE_FEED : ''
}

// The public website. Every build opens the official site for feedback and
// terms; opening a page in the browser sends nothing on the app's behalf.
export function siteOrigin(): string {
  return OFFICIAL_SITE_ORIGIN
}
