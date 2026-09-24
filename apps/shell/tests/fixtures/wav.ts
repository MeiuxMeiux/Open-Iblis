// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

interface ExtraChunk {
  id: string
  payload: Buffer
}

interface WavFixtureOptions {
  codec?: 'pcm' | 'ieee-float'
  extensible?: boolean
  sampleRateHz?: number
  channels?: number
  bitsPerSample?: number
  frames?: number
  data?: Buffer
  beforeFmt?: ExtraChunk[]
  beforeData?: ExtraChunk[]
}

function chunk(id: string, payload: Buffer): Buffer {
  if (Buffer.byteLength(id, 'latin1') !== 4) throw new Error(`chunk id must be four bytes: ${id}`)
  const header = Buffer.alloc(8)
  header.write(id, 0, 'latin1')
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload, ...(payload.length % 2 ? [Buffer.alloc(1)] : [])])
}

function fmtPayload(input: {
  codec: 'pcm' | 'ieee-float'
  extensible: boolean
  sampleRateHz: number
  channels: number
  bitsPerSample: number
}): Buffer {
  const blockAlign = input.channels * (input.bitsPerSample / 8)
  const payload = Buffer.alloc(input.extensible ? 40 : 16)
  payload.writeUInt16LE(input.extensible ? 0xfffe : input.codec === 'pcm' ? 1 : 3, 0)
  payload.writeUInt16LE(input.channels, 2)
  payload.writeUInt32LE(input.sampleRateHz, 4)
  payload.writeUInt32LE(input.sampleRateHz * blockAlign, 8)
  payload.writeUInt16LE(blockAlign, 12)
  payload.writeUInt16LE(input.bitsPerSample, 14)
  if (input.extensible) {
    payload.writeUInt16LE(22, 16)
    payload.writeUInt16LE(input.bitsPerSample, 18)
    payload.writeUInt32LE(0, 20)
    payload.writeUInt32LE(input.codec === 'pcm' ? 1 : 3, 24)
    Buffer.from([0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]).copy(
      payload,
      28
    )
  }
  return payload
}

export function makeWav(options: WavFixtureOptions = {}): Buffer {
  const codec = options.codec ?? 'pcm'
  const sampleRateHz = options.sampleRateHz ?? 8000
  const channels = options.channels ?? 1
  const bitsPerSample = options.bitsPerSample ?? (codec === 'pcm' ? 8 : 32)
  const blockAlign = channels * (bitsPerSample / 8)
  const data = options.data ?? Buffer.alloc((options.frames ?? sampleRateHz) * blockAlign)
  if (!Number.isInteger(blockAlign) || data.length % blockAlign !== 0) {
    throw new Error('fixture data must contain complete frames')
  }

  const chunks = [
    ...(options.beforeFmt ?? []).map((entry) => chunk(entry.id, entry.payload)),
    chunk(
      'fmt ',
      fmtPayload({
        codec,
        extensible: options.extensible ?? false,
        sampleRateHz,
        channels,
        bitsPerSample
      })
    ),
    ...(options.beforeData ?? []).map((entry) => chunk(entry.id, entry.payload)),
    chunk('data', data)
  ]
  const body = Buffer.concat([Buffer.from('WAVE'), ...chunks])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(body.length, 4)
  return Buffer.concat([riff, body])
}

export function multipartWav(wav: Buffer): Buffer {
  const head = Buffer.from('--ace-batch-boundary\r\nContent-Type: audio/wav\r\n\r\n', 'latin1')
  const tail = Buffer.from(
    '\r\n--ace-batch-boundary\r\nContent-Type: application/octet-stream\r\n\r\nLATENT\r\n--ace-batch-boundary--\r\n',
    'latin1'
  )
  return Buffer.concat([head, wav, tail])
}
