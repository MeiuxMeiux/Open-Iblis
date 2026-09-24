// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Strict RIFF/WAVE parsing shared by generation, library import, playback, and
// later waveform analysis. The declared RIFF length is authoritative: binary
// sample bytes may contain newlines or multipart boundary text, so neither is
// safe as an audio terminator.

import type { WavFacts } from '../../../shared/contract'

type WavCodec = 'pcm' | 'ieee-float'

export interface WavMetadata extends WavFacts {
  codec: WavCodec
}

export interface NormalizedWav {
  bytes: Buffer
  metadata: WavMetadata
}

export class WavError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'WavError'
  }
}

function fail(code: string, message: string): never {
  throw new WavError(code, message)
}

function hasTag(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > bytes.length) return false
  for (let i = 0; i < value.length; i++) {
    if (bytes[offset + i] !== value.charCodeAt(i)) return false
  }
  return true
}

function declaredContainerBytes(bytes: Uint8Array, view: DataView): number {
  if (bytes.length < 12) fail('header_too_short', 'WAV header is shorter than 12 bytes')
  if (!hasTag(bytes, 0, 'RIFF')) fail('not_riff', 'WAV container does not start with RIFF')
  if (!hasTag(bytes, 8, 'WAVE')) fail('not_wave', 'RIFF container is not WAVE')
  const riffSize = view.getUint32(4, true)
  if (riffSize === 0xffffffff) fail('streaming_size', 'RIFF length was never finalized')
  if (riffSize < 4) fail('bad_riff_size', `RIFF payload is too short: ${riffSize}`)
  return 8 + riffSize
}

function extensibleCodec(
  bytes: Uint8Array,
  view: DataView,
  fmtOffset: number,
  fmtBytes: number
): { codecTag: 1 | 3; validBitsPerSample: number; channelMask: number } {
  if (fmtBytes < 40) fail('bad_extensible_fmt', 'WAVE_FORMAT_EXTENSIBLE fmt chunk is too short')
  const extensionBytes = view.getUint16(fmtOffset + 16, true)
  if (extensionBytes < 22 || 18 + extensionBytes > fmtBytes) {
    fail('bad_extensible_fmt', 'WAVE_FORMAT_EXTENSIBLE extension length is invalid')
  }

  const guidOffset = fmtOffset + 24
  const codecTag = view.getUint32(guidOffset, true)
  const guidTail = [0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]
  if (
    (codecTag !== 1 && codecTag !== 3) ||
    !guidTail.every((value, index) => bytes[guidOffset + 4 + index] === value)
  ) {
    fail('unsupported_codec', 'WAVE_FORMAT_EXTENSIBLE subformat is not PCM or IEEE float')
  }
  return {
    codecTag,
    validBitsPerSample: view.getUint16(fmtOffset + 18, true),
    channelMask: view.getUint32(fmtOffset + 20, true)
  }
}

interface FmtChunk {
  formatTag: number
  codecTag: 1 | 3
  codec: WavCodec
  channels: number
  sampleRateHz: number
  byteRateBytesPerSec: number
  blockAlignBytes: number
  bitsPerSample: number
  validBitsPerSample?: number
  channelMask?: number
}

function readFmt(bytes: Uint8Array, view: DataView, offset: number, chunkBytes: number): FmtChunk {
  if (chunkBytes < 16) fail('bad_fmt', 'WAV fmt chunk is shorter than 16 bytes')
  const formatTag = view.getUint16(offset, true)
  const base = {
    formatTag,
    channels: view.getUint16(offset + 2, true),
    sampleRateHz: view.getUint32(offset + 4, true),
    byteRateBytesPerSec: view.getUint32(offset + 8, true),
    blockAlignBytes: view.getUint16(offset + 12, true),
    bitsPerSample: view.getUint16(offset + 14, true)
  }
  if (formatTag === 1 || formatTag === 3) {
    return { ...base, codecTag: formatTag, codec: formatTag === 1 ? 'pcm' : 'ieee-float' }
  }
  if (formatTag !== 0xfffe) fail('unsupported_codec', `WAV codec tag ${formatTag} is not supported`)
  const extensible = extensibleCodec(bytes, view, offset, chunkBytes)
  return {
    ...base,
    ...extensible,
    codec: extensible.codecTag === 1 ? 'pcm' : 'ieee-float'
  }
}

// Walks the top-level chunks of an exact container, keeping the single fmt
// and data chunk and skipping everything else.
function scanChunks(
  bytes: Uint8Array,
  view: DataView,
  containerBytes: number
): { fmt?: FmtChunk; data?: { offset: number; bytes: number } } {
  let fmt: FmtChunk | undefined
  let data: { offset: number; bytes: number } | undefined
  let offset = 12
  while (offset < containerBytes) {
    if (offset + 8 > containerBytes)
      fail('truncated_chunk_header', 'RIFF chunk header is truncated')
    const chunkBytes = view.getUint32(offset + 4, true)
    if (chunkBytes === 0xffffffff) fail('streaming_size', 'RIFF chunk length was never finalized')
    const payloadOffset = offset + 8
    const payloadEnd = payloadOffset + chunkBytes
    if (payloadEnd > containerBytes) fail('truncated_chunk', 'RIFF chunk payload exceeds container')
    const paddedEnd = payloadEnd + (chunkBytes % 2)
    if (paddedEnd > containerBytes)
      fail('missing_chunk_pad', 'Odd RIFF chunk is missing its pad byte')

    if (hasTag(bytes, offset, 'fmt ')) {
      if (fmt) fail('duplicate_fmt', 'WAV contains more than one fmt chunk')
      fmt = readFmt(bytes, view, payloadOffset, chunkBytes)
    } else if (hasTag(bytes, offset, 'data')) {
      if (data) fail('duplicate_data', 'WAV contains more than one data chunk')
      data = { offset: payloadOffset, bytes: chunkBytes }
    }
    offset = paddedEnd
  }
  return { ...(fmt ? { fmt } : {}), ...(data ? { data } : {}) }
}

function checkFormat(fmt: FmtChunk, dataBytes: number): void {
  const { codec, channels, sampleRateHz, bitsPerSample, validBitsPerSample } = fmt
  if (channels <= 0) fail('bad_channels', 'WAV channel count must be positive')
  if (sampleRateHz <= 0) fail('bad_sample_rate', 'WAV sample rate must be positive')
  const allowedDepths = codec === 'pcm' ? [8, 16, 24, 32] : [32, 64]
  if (!allowedDepths.includes(bitsPerSample)) {
    fail('bad_bit_depth', `${codec} WAV bit depth ${bitsPerSample} is not supported`)
  }
  if (
    validBitsPerSample !== undefined &&
    (validBitsPerSample <= 0 || validBitsPerSample > bitsPerSample)
  ) {
    fail('bad_valid_bits', 'WAV valid-bits value is outside its sample container')
  }

  const expectedBlockAlign = channels * (bitsPerSample / 8)
  if (fmt.blockAlignBytes !== expectedBlockAlign) {
    fail(
      'bad_block_align',
      `WAV block alignment ${fmt.blockAlignBytes} does not match ${expectedBlockAlign}`
    )
  }
  const expectedByteRate = sampleRateHz * expectedBlockAlign
  if (fmt.byteRateBytesPerSec !== expectedByteRate) {
    fail(
      'bad_byte_rate',
      `WAV byte rate ${fmt.byteRateBytesPerSec} does not match ${expectedByteRate}`
    )
  }
  if (dataBytes <= 0) fail('empty_data', 'WAV data chunk is empty')
  if (dataBytes % fmt.blockAlignBytes !== 0) {
    fail('unaligned_data', 'WAV data length is not an exact number of sample frames')
  }
}

// Exact parser: the supplied bytes must be one complete RIFF container with no
// multipart framing or truncated payload around it.
export function parseWav(bytes: Uint8Array): WavMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const containerBytes = declaredContainerBytes(bytes, view)
  if (containerBytes > bytes.length) {
    fail('truncated_container', `RIFF declares ${containerBytes} bytes; received ${bytes.length}`)
  }
  if (containerBytes < bytes.length) {
    fail('trailing_bytes', `RIFF declares ${containerBytes} bytes; received ${bytes.length}`)
  }

  const { fmt, data } = scanChunks(bytes, view, containerBytes)
  if (!fmt) fail('missing_fmt', 'WAV has no supported fmt chunk')
  if (!data) fail('missing_data', 'WAV has no data chunk')
  checkFormat(fmt, data.bytes)

  const frames = data.bytes / fmt.blockAlignBytes
  const durationSec = frames / fmt.sampleRateHz
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    fail('bad_duration', 'WAV duration is not finite and positive')
  }

  return {
    containerBytes,
    formatTag: fmt.formatTag,
    codecTag: fmt.codecTag,
    codec: fmt.codec,
    sampleRateHz: fmt.sampleRateHz,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    ...(fmt.validBitsPerSample !== undefined ? { validBitsPerSample: fmt.validBitsPerSample } : {}),
    ...(fmt.channelMask !== undefined ? { channelMask: fmt.channelMask } : {}),
    blockAlignBytes: fmt.blockAlignBytes,
    byteRateBytesPerSec: fmt.byteRateBytesPerSec,
    dataOffset: data.offset,
    dataBytes: data.bytes,
    frames,
    durationSec
  }
}

// Multipart parser seam: take one candidate beginning at RIFF, discard only
// bytes beyond the RIFF-declared container, then validate the exact prefix.
export function normalizeWavPrefix(candidate: Buffer): NormalizedWav {
  const view = new DataView(candidate.buffer, candidate.byteOffset, candidate.byteLength)
  const containerBytes = declaredContainerBytes(candidate, view)
  if (containerBytes > candidate.length) {
    fail(
      'truncated_container',
      `RIFF declares ${containerBytes} bytes; received ${candidate.length}`
    )
  }
  const bytes = candidate.subarray(0, containerBytes)
  return { bytes, metadata: parseWav(bytes) }
}

export function tryParseWav(bytes: Uint8Array): WavMetadata | undefined {
  try {
    return parseWav(bytes)
  } catch {
    return undefined
  }
}
