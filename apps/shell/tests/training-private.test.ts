// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Private trainings (D2 as amended by D-O2): a keyless install checks the
// name locally and never calls the trainings service; a keyed install keeps
// the reserve -> train -> upload flow.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const remote = vi.hoisted(() => ({
  reserveTrainingName: vi.fn(),
  trainingsRequest: vi.fn(),
  trainingsConfigured: vi.fn(() => false)
}))
const lease = vi.hoisted(() => ({ value: null as string | null }))
const styles = vi.hoisted(() => ({ names: [] as string[] }))

vi.mock('../electron/main/training/remote', () => remote)
// Keep the engine/queue graph (native images, drag icons) out of this test.
vi.mock('../electron/main/generation-queue', () => ({
  queueSnapshot: async () => ({ activeId: null, pendingCount: 0 })
}))
vi.mock('../electron/main/resource-state', () => ({ resourceCoordinator: vi.fn() }))
vi.mock('../electron/main/sidecar/supervisor', () => ({
  healthAll: () => ({}),
  requestSidecar: vi.fn(),
  start: vi.fn(),
  stop: vi.fn()
}))
vi.mock('../electron/main/licensing', () => ({
  currentLeaseForFeature: () => lease.value,
  currentLease: () => lease.value
}))
vi.mock('../electron/main/adapters', () => ({
  listAdapters: async () => styles.names.map((displayName) => ({ displayName })),
  importAdapterFile: vi.fn(),
  downloadAdapterFile: vi.fn()
}))

import { checkPrivateName, trainingVisibility } from '../electron/main/training/private'
import { currentTrainingVisibility, reserveTraining } from '../electron/main/training'

beforeEach(() => {
  vi.stubEnv('IBLIS_OFFICIAL_BUILD', 'true')
  vi.stubEnv('IBLIS_TRAININGS_BASE', '')
  lease.value = null
  styles.names = []
  remote.reserveTrainingName.mockReset()
})

describe('training visibility', () => {
  it('is community only with both an endpoint and a styles-community lease', () => {
    expect(trainingVisibility(true, 'lease')).toBe('community')
    expect(trainingVisibility(true, null)).toBe('private')
    expect(trainingVisibility(false, 'lease')).toBe('private')
  })

  it('is private in a source build even with a lease', () => {
    vi.stubEnv('IBLIS_OFFICIAL_BUILD', 'false')
    lease.value = 'lease'
    expect(currentTrainingVisibility()).toBe('private')
  })
})

describe('checkPrivateName', () => {
  it('applies the server name rules', () => {
    expect(checkPrivateName('Bad Name', [], []).available).toBe(false)
    expect(checkPrivateName('ab', [], []).available).toBe(false)
    const ok = checkPrivateName('fern-static', [], [])
    expect(ok).toMatchObject({ available: true, visibility: 'private', version: 1 })
    expect(ok.trainingId).toMatch(/^local-[0-9a-f]{16}$/)
  })

  it('is unique against local trainings and styles only', () => {
    expect(checkPrivateName('fern', ['fern'], []).available).toBe(false)
    expect(checkPrivateName('fern', [], ['fern (texture)']).available).toBe(false)
    expect(checkPrivateName('fern', [], ['fern-two', 'other']).available).toBe(true)
  })
})

describe('reserveTraining', () => {
  it('keyless: checks the name locally and never calls the trainings service', async () => {
    styles.names = ['taken-name']
    const result = await reserveTraining('fern-static', ['texture'])
    expect(result).toMatchObject({ available: true, visibility: 'private' })
    expect((await reserveTraining('taken-name', ['texture'])).available).toBe(false)
    expect(remote.reserveTrainingName).not.toHaveBeenCalled()
  })

  it('keyed: reserves on the community service as before', async () => {
    lease.value = 'lease'
    remote.reserveTrainingName.mockResolvedValue({
      available: true,
      trainingId: 'tr-0123456789abcdef',
      version: 1,
      reserved: { trainingId: 'tr-0123456789abcdef', version: 1, claimToken: 'c'.repeat(48) }
    })
    const result = await reserveTraining('fern-static', ['texture'])
    expect(remote.reserveTrainingName).toHaveBeenCalledWith('fern-static', ['texture'])
    expect(result).toEqual({
      available: true,
      visibility: 'community',
      trainingId: 'tr-0123456789abcdef',
      version: 1,
      message: undefined
    })
  })
})
