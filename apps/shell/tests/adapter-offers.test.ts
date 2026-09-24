// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { adapterOffers, downloadableAdapterOffer } from '../electron/main/adapters/offers'

describe('community style offers', () => {
  it('keeps download locations in main while exposing complete music-facing disclosures', () => {
    const offers = adapterOffers()
    const kawaii = offers.find((offer) => offer.id === 'kawaii-future-bass-v1')

    expect(kawaii).toMatchObject({
      installable: true,
      format: 'safetensors',
      compatibility: 'unverified',
      rights: 'commercial-claim',
      requiresRiskAcknowledgement: true
    })
    expect(kawaii?.terms).toContain('does not establish')
    expect(JSON.stringify(kawaii)).not.toContain('/resolve/')
  })

  it('allows only explicitly installable offers to reach the downloader', () => {
    expect(downloadableAdapterOffer('chinese-new-year-v1').download.files).toHaveLength(2)
    expect(downloadableAdapterOffer('funk-dora-v2').download.files).toHaveLength(1)
    expect(() => downloadableAdapterOffer('demon-reference-v1')).toThrow('not available')
  })

  it('keeps every unreviewed adapter record in a separately labelled experimental lane', () => {
    const experimental = adapterOffers().filter((offer) => offer.lane === 'experimental')

    expect(experimental.map((offer) => offer.id)).toContain('super-eurobeats-v1')
    expect(experimental.map((offer) => offer.id)).toContain('demon-reference-v1')
    expect(experimental.filter((offer) => offer.installable)).toHaveLength(11)
    expect(experimental.every((offer) => offer.requiresRiskAcknowledgement)).toBe(true)
  })

  it('pins every downloadable community file to a reviewed revision, size, and hash', () => {
    const offers = adapterOffers().filter((offer) => offer.installable)

    expect(offers.length).toBeGreaterThanOrEqual(7)
    for (const offer of offers) {
      expect(offer.requiresRiskAcknowledgement).toBe(true)
      expect(offer.sourceRevision).toMatch(/^[a-f0-9]{40}$/)
      expect(offer.bytes).toBeGreaterThan(0)
      const privateOffer = downloadableAdapterOffer(offer.id)
      for (const file of privateOffer.download.files) {
        expect(file.bytes).toBeGreaterThan(0)
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
        expect(file.url).toContain(`/resolve/${offer.sourceRevision}/`)
      }
    }
  })
})
