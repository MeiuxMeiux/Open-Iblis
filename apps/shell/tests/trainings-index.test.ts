// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  originHashOf,
  parseTrainingsIndex,
  verifyTrainingsIndex
} from '../electron/main/styles/trainings-index'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tr-0123456789abcdef',
    name: 'my-style',
    version: 1,
    categories: ['texture'],
    tags: ['neuro', 'bass'],
    bytes: 42_000_000,
    sha256: 'a'.repeat(64),
    files: [
      {
        name: 'adapter_texture.safetensors',
        bytes: 42_000_000,
        sha256: 'a'.repeat(64),
        url: 'https://storage.googleapis.com/iblis-dist/trainings/tr-0123456789abcdef/v1/adapter_texture.safetensors'
      }
    ],
    previewUrl: null,
    createdAt: '2026-07-14T00:00:00+00:00',
    updatedAt: '2026-07-14T00:00:00+00:00',
    downloadCount: 0,
    minAppVersion: null,
    originHash: originHashOf('some-install'),
    ...overrides
  }
}

function indexBytes(entries: Record<string, unknown>[]): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        schema: 1,
        generatedAt: '2026-07-14T00:00:00+00:00',
        shard: { index: 0, count: 1 },
        trainings: entries
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
}

function signature(bytes: Buffer): string {
  return sign(null, bytes, privateKey).toString('base64')
}

describe('trainings index verification', () => {
  it('accepts a correctly signed, well-formed index', () => {
    const bytes = indexBytes([entry()])
    const index = verifyTrainingsIndex(bytes, signature(bytes), pubPem)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]!.name).toBe('my-style')
  })

  it('rejects a tampered byte even with a valid-looking signature string', () => {
    const bytes = indexBytes([entry()])
    const sig = signature(bytes)
    const tampered = Buffer.from(bytes.toString('utf8').replace('my-style', 'ny-style'), 'utf8')
    expect(() => verifyTrainingsIndex(tampered, sig, pubPem)).toThrow('signature')
  })

  it('rejects a valid signature over an invalid document', () => {
    const bad = indexBytes([entry({ files: [] })])
    expect(() => verifyTrainingsIndex(bad, signature(bad), pubPem)).toThrow('invalid')
  })

  it('rejects file URLs outside the public trainings prefix', () => {
    const bad = [
      entry({
        files: [
          {
            name: 'adapter_texture.safetensors',
            bytes: 1,
            sha256: 'a'.repeat(64),
            url: 'https://evil.example/adapter.safetensors'
          }
        ]
      })
    ]
    expect(() => parseTrainingsIndex(indexBytes(bad))).toThrow('invalid')
  })

  it('rejects an unknown schema outright', () => {
    const bytes = Buffer.from(JSON.stringify({ schema: 2, trainings: [] }), 'utf8')
    expect(() => parseTrainingsIndex(bytes)).toThrow('schema')
  })

  it('hashes install ids the way the server publishes originHash', () => {
    expect(originHashOf('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
