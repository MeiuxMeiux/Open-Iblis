// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { carveWav, EngineError } from '../electron/main/engine/drivers/ace-compat/protocol'
import { normalizeWavPrefix, parseWav, WavError } from '../electron/main/media/wav'
import { makeWav, multipartWav } from './fixtures/wav'

function errorCode(bytes: Uint8Array): string | undefined {
  try {
    parseWav(bytes)
  } catch (error) {
    return error instanceof WavError ? error.code : 'unexpected'
  }
  return undefined
}

describe('strict RIFF/WAVE facts', () => {
  it('parses exact float32 stereo 48 kHz metadata', () => {
    const wav = makeWav({ codec: 'ieee-float', sampleRateHz: 48000, channels: 2, frames: 2 })
    expect(parseWav(wav)).toEqual({
      containerBytes: 60,
      formatTag: 3,
      codecTag: 3,
      codec: 'ieee-float',
      sampleRateHz: 48000,
      channels: 2,
      bitsPerSample: 32,
      blockAlignBytes: 8,
      byteRateBytesPerSec: 384000,
      dataOffset: 44,
      dataBytes: 16,
      frames: 2,
      durationSec: 2 / 48000
    })
  })

  it('accepts PCM, extensible float, and padded unknown chunks', () => {
    const pcm = parseWav(makeWav({ sampleRateHz: 8000, frames: 24000 }))
    expect(pcm.codec).toBe('pcm')
    expect(pcm.durationSec).toBe(3)

    const extensible = parseWav(
      makeWav({ codec: 'ieee-float', extensible: true, sampleRateHz: 48000, channels: 2 })
    )
    expect(extensible).toMatchObject({
      formatTag: 0xfffe,
      codecTag: 3,
      codec: 'ieee-float',
      validBitsPerSample: 32,
      channelMask: 0
    })

    const padded = parseWav(
      makeWav({
        frames: 2,
        beforeFmt: [{ id: 'JUNK', payload: Buffer.from([1, 2, 3]) }],
        beforeData: [{ id: 'LIST', payload: Buffer.from([4, 5, 6, 7, 8]) }]
      })
    )
    expect(padded.dataOffset).toBeGreaterThan(44)
    expect(padded.frames).toBe(2)
  })

  it('normalizes only the RIFF-declared prefix', () => {
    const wav = makeWav({ frames: 8 })
    const normalized = normalizeWavPrefix(Buffer.concat([wav, Buffer.from('\r\nframing')]))
    expect(normalized.bytes.equals(wav)).toBe(true)
    expect(normalized.metadata.containerBytes).toBe(wav.length)
    expect(errorCode(Buffer.concat([wav, Buffer.from('extra')]))).toBe('trailing_bytes')
  })

  it('rejects malformed structural and audio facts with stable codes', () => {
    const canonical = makeWav({ frames: 8 })
    const unaligned = makeWav({ bitsPerSample: 16, frames: 4 })
    const cases: [string, Buffer][] = [
      ['header_too_short', Buffer.alloc(4)],
      ['not_riff', Buffer.from(canonical).fill(0, 0, 4)],
      ['truncated_container', canonical.subarray(0, canonical.length - 1)],
      ['unsupported_codec', Buffer.from(canonical)],
      ['bad_channels', Buffer.from(canonical)],
      ['bad_sample_rate', Buffer.from(canonical)],
      ['bad_byte_rate', Buffer.from(canonical)],
      ['bad_block_align', Buffer.from(canonical)],
      ['unaligned_data', unaligned]
    ]
    cases[3]![1].writeUInt16LE(7, 20)
    cases[4]![1].writeUInt16LE(0, 22)
    cases[5]![1].writeUInt32LE(0, 24)
    cases[6]![1].writeUInt32LE(1, 28)
    cases[7]![1].writeUInt16LE(2, 32)
    cases[8]![1].writeUInt32LE(7, 40)

    for (const [expected, bytes] of cases) expect(errorCode(bytes), expected).toBe(expected)
  })
})

describe('multipart WAV extraction', () => {
  it('extracts a typed part and fallback RIFF byte-for-byte', () => {
    const wav = makeWav({ codec: 'ieee-float', channels: 2, frames: 4 })
    expect(carveWav(multipartWav(wav)).bytes.equals(wav)).toBe(true)
    const fallback = Buffer.concat([
      Buffer.from('--ace-batch-boundary\r\n\r\n'),
      wav,
      Buffer.from('\r\n--ace-batch-boundary--')
    ])
    expect(carveWav(fallback).bytes.equals(wav)).toBe(true)
  })

  it('preserves terminal CR/LF samples and boundary text inside audio', () => {
    const data = Buffer.alloc(32)
    data.write('--ace-batch-boundary', 0, 'latin1')
    data[data.length - 2] = 0x0d
    data[data.length - 1] = 0x0a
    const wav = makeWav({ codec: 'ieee-float', channels: 2, data })
    const carved = carveWav(multipartWav(wav)).bytes
    expect(carved.equals(wav)).toBe(true)
    expect(carved.subarray(-2).equals(Buffer.from([0x0d, 0x0a]))).toBe(true)
  })

  it('rejects a truncated declared RIFF before persistence', () => {
    const wav = makeWav({ frames: 4 })
    wav.writeUInt32LE(wav.readUInt32LE(4) + 100, 4)
    try {
      carveWav(multipartWav(wav))
      throw new Error('expected carveWav to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError)
      expect((error as EngineError).code).toBe('bad_wav')
      expect((error as Error).message).toMatch(/truncated_container/)
    }
  })
})
