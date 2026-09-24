// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Curated-offer data validation. The shipped JSON documents (offers.data.json
// and experimental-offers.data.json) are checked here at startup so a
// malformed data edit throws immediately instead of reaching the renderer.
import type { AdapterOffer } from '../../../shared/adapters'

interface DownloadableAdapterFile {
  path: string
  url: string
  bytes: number
  sha256: string
}

export interface DownloadableOffer extends AdapterOffer {
  download: { files: DownloadableAdapterFile[] }
}

const REVISION = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const FORMATS: readonly string[] = ['safetensors', 'peft']
const COMPATIBILITIES: readonly string[] = ['matches-active-pack', 'different-model', 'unverified']
const RIGHTS: readonly string[] = ['commercial-claim', 'research-only', 'unknown']

function bad(id: string, reason: string): never {
  throw new Error(`Malformed curated style offer ${id}: ${reason}`)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function optionalText(value: unknown): boolean {
  return value === undefined || text(value)
}

function validateFile(id: string, value: unknown, revision: string): DownloadableAdapterFile {
  const file = value as Partial<DownloadableAdapterFile>
  if (!text(file.path)) bad(id, 'download file path')
  if (typeof file.bytes !== 'number' || file.bytes <= 0) bad(id, 'download file bytes')
  if (!text(file.sha256) || !SHA256.test(file.sha256)) bad(id, 'download file sha256')
  if (!text(file.url) || !file.url.startsWith('https://huggingface.co/')) {
    bad(id, 'download file url host')
  }
  if (!file.url.includes(`/resolve/${revision}/`)) bad(id, 'download file revision pin')
  return { path: file.path, url: file.url, bytes: file.bytes, sha256: file.sha256 }
}

function validateOffer(raw: unknown, lane: AdapterOffer['lane']): DownloadableOffer {
  const offer = raw as DownloadableOffer
  if (!text(offer.id)) bad('(missing id)', 'id')
  const id = offer.id
  if (!text(offer.name) || !text(offer.maker) || !text(offer.description)) bad(id, 'identity copy')
  if (!Array.isArray(offer.tags) || offer.tags.length === 0 || !offer.tags.every(text)) {
    bad(id, 'tags')
  }
  if (!FORMATS.includes(offer.format)) bad(id, 'format')
  if (!text(offer.sourceUrl) || !offer.sourceUrl.startsWith('https://')) bad(id, 'source url')
  if (!text(offer.sourceRevision) || !REVISION.test(offer.sourceRevision)) {
    bad(id, 'source revision')
  }
  if (!text(offer.claimedLicense) || !text(offer.terms) || !text(offer.claimedBaseModel)) {
    bad(id, 'publisher claims')
  }
  if (!COMPATIBILITIES.includes(offer.compatibility)) bad(id, 'compatibility')
  if (!RIGHTS.includes(offer.rights)) bad(id, 'rights')
  // A publisher card or license label cannot establish training, publicity,
  // copyright, or runtime compatibility rights. The GUI requires this explicit
  // acknowledgement in addition to the native disclosure — data cannot opt out.
  if (offer.requiresRiskAcknowledgement !== true) bad(id, 'risk acknowledgement flag')
  if (offer.lane !== lane) bad(id, 'lane')
  if (typeof offer.installable !== 'boolean') bad(id, 'installable flag')
  if (!optionalText(offer.availabilityNote) || !optionalText(offer.trigger)) bad(id, 'notes')
  if (offer.defaultScale !== undefined) {
    if (typeof offer.defaultScale !== 'number' || offer.defaultScale <= 0) bad(id, 'default scale')
  }
  const rawFiles: unknown = (offer as Partial<DownloadableOffer>).download?.files
  if (!Array.isArray(rawFiles)) bad(id, 'download files')
  const files = rawFiles.map((file) => validateFile(id, file, offer.sourceRevision))
  if (offer.installable && files.length === 0) bad(id, 'installable without files')
  const total = files.reduce((sum, file) => sum + file.bytes, 0)
  if (offer.bytes !== total) bad(id, 'bytes must equal the sum of download file bytes')
  return { ...offer, download: { files } }
}

export function validateOffers(data: unknown, lane: AdapterOffer['lane']): DownloadableOffer[] {
  if (!Array.isArray(data)) throw new Error(`Curated ${lane} offer data is not an array`)
  const offers = data.map((raw) => validateOffer(raw, lane))
  const ids = new Set(offers.map((offer) => offer.id))
  if (ids.size !== offers.length) throw new Error(`Curated ${lane} offer data repeats an id`)
  return offers
}
