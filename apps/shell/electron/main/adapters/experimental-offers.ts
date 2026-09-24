// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { validateOffers, type DownloadableOffer } from './offer-data'
import experimentalData from './experimental-offers.data.json'

// These records deliberately widen access to every adapter-weight file in
// Hugging Face's ACE-Step 1.5 adapter inventory. Each download stays pinned
// and hashed; publisher metadata and the native loader remain unverified.
// The records live in experimental-offers.data.json; validateOffers throws
// at startup on malformed data.
export const experimentalOffers: DownloadableOffer[] = validateOffers(
  experimentalData,
  'experimental'
)
