// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AdapterOffer } from '../../../shared/adapters'
import { validateOffers, type DownloadableOffer } from './offer-data'
import { experimentalOffers } from './experimental-offers'
import communityData from './offers.data.json'

export type { DownloadableOffer } from './offer-data'

// These are reviewed, immutable publisher records rather than a renderer-side
// search index. Main owns their URLs and verifies the exact bytes before a
// managed-library import. A card is a community claim, never Iblis approval.
// The records live in offers.data.json; validateOffers throws at startup on
// malformed data, so an offer edit is a data change with the same guarantees.
const COMMUNITY_OFFERS: DownloadableOffer[] = validateOffers(communityData, 'community')

const OFFERS: DownloadableOffer[] = [...COMMUNITY_OFFERS, ...experimentalOffers]

export function adapterOffers(): AdapterOffer[] {
  const visible = structuredClone(OFFERS) as (AdapterOffer & { download?: unknown })[]
  for (const offer of visible) delete offer.download
  return visible
}

export function downloadableAdapterOffer(id: string): DownloadableOffer {
  const selected = OFFERS.find((candidate) => candidate.id === id)
  if (!selected?.installable || selected.download.files.length === 0) {
    throw new Error('This community style is not available for in-app installation')
  }
  return selected
}
