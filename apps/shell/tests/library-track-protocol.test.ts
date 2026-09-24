// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (request: Request) => Promise<Response>

const state = vi.hoisted(() => ({
  handler: null as Handler | null,
  logs: [] as { message: string; fields: unknown }[],
  respond: (): Promise<Response> => Promise.resolve(new Response('audio'))
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/iblis-test', isPackaged: false },
  protocol: {
    handle: (_scheme: string, handler: Handler) => {
      state.handler = handler
    }
  },
  shell: {},
  nativeImage: { createFromDataURL: () => ({}) },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../electron/main/logger', () => ({
  log: (_level: string, message: string, fields: unknown) => {
    state.logs.push({ message, fields })
  }
}))
vi.mock('../electron/main/library/store', () => ({
  createLibraryStore: () => ({
    get: (id: string) => Promise.resolve(id === 'known' ? { id, format: 'wav' } : null)
  })
}))
vi.mock('../electron/main/library/deletion', () => ({
  recoverStagedTrackDeletions: () => Promise.resolve({ restored: 0, discarded: 0, retained: 0 }),
  commitTrackDeletion: vi.fn(),
  stagedTrackDirectory: vi.fn()
}))
vi.mock('../electron/main/library/paths', () => ({
  trackDirectory: vi.fn(),
  trackStorage: () => Promise.resolve({ audioFile: '/tracks/known/audio.wav' })
}))
vi.mock('../electron/main/library/import', () => ({
  importOrphans: () => Promise.resolve({ imported: 0 })
}))
vi.mock('../electron/main/media/file', () => ({
  mediaMime: () => 'audio/wav',
  respondWithLocalFile: () => state.respond()
}))

process.env.IBLIS_TRACKS_DIR = '/tmp/iblis-test-tracks'
const { registerTrackProtocol } = await import('../electron/main/library')

function serve(id: string): Promise<Response> {
  if (!state.handler) throw new Error('protocol handler not registered')
  return state.handler(new Request(`iblis-track://${id}/`))
}

describe('iblis-track protocol', () => {
  beforeEach(() => {
    state.logs = []
    state.respond = () => Promise.resolve(new Response('audio'))
    registerTrackProtocol()
  })

  it('serves a known track', async () => {
    const response = await serve('known')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('audio')
  })

  it('returns 404 for an unknown track', async () => {
    expect((await serve('missing')).status).toBe(404)
  })

  it('turns a file read failure into a logged 404', async () => {
    state.respond = () =>
      Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    const response = await serve('known')
    expect(response.status).toBe(404)
    expect(state.logs).toContainEqual({
      message: 'library media read failed',
      fields: { trackId: 'known', error: 'permission denied' }
    })
  })
})
