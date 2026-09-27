// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, net, protocol } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { respondWithLocalFile } from '../electron/main/media/file'
import { makeWav } from './fixtures/wav'

const SCHEME = 'iblis-media-test'
const URL = `${SCHEME}://fixture/audio.wav`
const LONG_URL = `${SCHEME}://fixture/long.wav`

// Must match registerMediaSchemes (electron/main/media/schemes.ts): standard
// is what keeps Chromium's media loader handling partial ranges correctly;
// without it the buffered range can freeze after a pause and a seek past it
// errors the pipeline (FB-QP78D7N1).
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, stream: true } }
])

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function responseBytes(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer())
}

async function browserObservation(): Promise<{
  durationSec: number
  seekableStartSec: number
  seekableEndSec: number
  seekedSec: number[]
  navigationStartSec: number
  navigationEndSec: number
  sameAudioElement: boolean
}> {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  try {
    const html = `<div id="view">Library</div><audio id="player" muted preload="auto" src="${URL}"></audio>`
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return (await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const audio = document.getElementById('player')
        const timeout = setTimeout(() => reject(new Error('audio metadata timed out')), 10000)
        let started = false
        const seekTo = (target) => new Promise((seekResolve, seekReject) => {
          const seekTimeout = setTimeout(() => seekReject(new Error('audio seek timed out')), 5000)
          audio.addEventListener('seeked', () => {
            clearTimeout(seekTimeout)
            seekResolve(audio.currentTime)
          }, { once: true })
          audio.currentTime = target
        })
        const waitUntil = (predicate, message) => new Promise((waitResolve, waitReject) => {
          const startedAt = performance.now()
          const check = () => {
            if (predicate()) return waitResolve()
            if (performance.now() - startedAt > 3000) return waitReject(new Error(message))
            setTimeout(check, 10)
          }
          check()
        })
        const inspect = () => {
          if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.seekable.length === 0) return
          if (started) return
          started = true
          const last = audio.seekable.length - 1
          const durationSec = audio.duration
          void (async () => {
            const targets = [durationSec * 0.25, durationSec * 0.9, durationSec - 0.01, 0]
            const seekedSec = []
            for (const target of targets) seekedSec.push(await seekTo(target))
            const audioBeforeNavigation = audio
            audio.muted = true
            await audio.play()
            await waitUntil(() => audio.currentTime >= 0.08, 'audio did not begin playback')
            const navigationStartSec = audio.currentTime
            document.getElementById('view').replaceChildren(document.createElement('main'))
            document.getElementById('view').firstElementChild.textContent = 'Create'
            const sameAudioElement = audioBeforeNavigation === document.getElementById('player')
            await waitUntil(
              () => audio.currentTime >= navigationStartSec + 0.08,
              'audio stopped across view replacement'
            )
            const navigationEndSec = audio.currentTime
            audio.pause()
            clearTimeout(timeout)
            resolve({
              durationSec,
              seekableStartSec: audio.seekable.start(last),
              seekableEndSec: audio.seekable.end(last),
              seekedSec,
              navigationStartSec,
              navigationEndSec,
              sameAudioElement
            })
          })().catch(reject)
        }
        audio.addEventListener('loadedmetadata', inspect)
        audio.addEventListener('durationchange', inspect)
        audio.addEventListener('progress', inspect)
        audio.addEventListener('canplay', inspect)
        audio.addEventListener('error', () => reject(new Error('audio element failed to load')))
        audio.load()
        inspect()
      })
    `)) as {
      durationSec: number
      seekableStartSec: number
      seekableEndSec: number
      seekedSec: number[]
      navigationStartSec: number
      navigationEndSec: number
      sameAudioElement: boolean
    }
  } finally {
    window.destroy()
  }
}

// Regression probe for FB-QP78D7N1 on a file far larger than Chromium's
// buffer-ahead window: pause, resume, then seek into the unbuffered tail.
// Without standard scheme privileges the seek kills the media pipeline
// (MEDIA_ERR_NETWORK, "FFmpegDemuxer: data source error") and playback near
// the frozen buffer edge stalls on "Buffering" forever.
async function pauseResumeSeekProbe(): Promise<{
  resumed: boolean
  seekTargetSec: number
  afterSeekPlays: boolean
  mediaErrorCode: number | null
}> {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  try {
    const html = `<audio id="player" muted preload="auto" src="${LONG_URL}"></audio>`
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return (await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const audio = document.getElementById('player')
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
        const waitUntil = async (predicate, ms) => {
          const startedAt = performance.now()
          while (performance.now() - startedAt < ms) {
            if (predicate()) return true
            await sleep(50)
          }
          return predicate()
        }
        ;(async () => {
          await audio.play()
          if (!(await waitUntil(() => audio.currentTime >= 1.5, 10000)))
            throw new Error('long fixture never started playing')
          const pausedAt = audio.currentTime
          audio.pause()
          // Long enough for Chromium's download to go idle (stalled fires ~3s).
          await sleep(8000)
          await audio.play()
          const resumed = await waitUntil(() => audio.currentTime >= pausedAt + 1, 15000)
          // Play beyond the initially buffered window before seeking; the
          // pipeline error needs the loader to have cycled through suspends.
          audio.playbackRate = 2
          const playsPastBuffer = await waitUntil(() => audio.currentTime >= 25, 40000)
          audio.playbackRate = 1
          if (!playsPastBuffer) {
            resolve({
              resumed,
              seekTargetSec: -1,
              afterSeekPlays: false,
              mediaErrorCode: audio.error ? audio.error.code : null
            })
            return
          }
          const seekTargetSec = Math.floor(audio.duration * 0.5)
          audio.currentTime = seekTargetSec
          const afterSeekPlays = await waitUntil(
            () => audio.currentTime >= seekTargetSec + 0.5,
            15000
          )
          resolve({
            resumed,
            seekTargetSec,
            afterSeekPlays,
            mediaErrorCode: audio.error ? audio.error.code : null
          })
        })().catch(reject)
      })
    `)) as {
      resumed: boolean
      seekTargetSec: number
      afterSeekPlays: boolean
      mediaErrorCode: number | null
    }
  } finally {
    window.destroy()
  }
}

async function run(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'iblis-electron-media-'))
  const file = join(root, 'audio.wav')
  const wav = makeWav({
    codec: 'ieee-float',
    sampleRateHz: 48000,
    channels: 2,
    frames: 48000
  })
  await writeFile(file, wav)
  // Ten minutes of 44.1k stereo 16-bit PCM (~101 MB): big enough that the
  // half-way seek lands well outside anything Chromium buffered ahead.
  const longFile = join(root, 'long.wav')
  await writeFile(
    longFile,
    makeWav({
      codec: 'pcm',
      sampleRateHz: 44100,
      channels: 2,
      bitsPerSample: 16,
      frames: 44100 * 600
    })
  )
  protocol.handle(SCHEME, (request) => {
    const target = new globalThis.URL(request.url).pathname === '/long.wav' ? longFile : file
    return respondWithLocalFile(request, target)
  })

  try {
    const full = await net.fetch(URL)
    assert(full.status === 200, `full response was ${full.status}`)
    assert(full.headers.get('content-type') === 'audio/wav', 'full MIME mismatch')
    assert(full.headers.get('content-length') === String(wav.length), 'full length mismatch')
    assert((await responseBytes(full)).equals(wav), 'full response bytes differ')

    const partial = await net.fetch(URL, { headers: { Range: 'bytes=12-43' } })
    assert(partial.status === 206, `partial response was ${partial.status}`)
    assert(partial.headers.get('content-range') === `bytes 12-43/${wav.length}`, 'range mismatch')
    assert((await responseBytes(partial)).equals(wav.subarray(12, 44)), 'partial bytes differ')

    const suffix = await net.fetch(URL, { headers: { Range: 'bytes=-16' } })
    assert(suffix.status === 206, `suffix response was ${suffix.status}`)
    assert((await responseBytes(suffix)).equals(wav.subarray(-16)), 'suffix bytes differ')

    const unsatisfied = await net.fetch(URL, { headers: { Range: `bytes=${wav.length}-` } })
    assert(unsatisfied.status === 416, `unsatisfied response was ${unsatisfied.status}`)
    assert(
      unsatisfied.headers.get('content-range') === `bytes */${wav.length}`,
      'unsatisfied Content-Range mismatch'
    )

    const head = await net.fetch(URL, { method: 'HEAD', headers: { Range: 'bytes=12-43' } })
    assert(head.status === 200, `HEAD response was ${head.status}`)
    assert(head.headers.get('content-length') === String(wav.length), 'HEAD length mismatch')
    assert((await responseBytes(head)).length === 0, 'HEAD unexpectedly returned a body')

    const observed = await browserObservation()
    assert(Math.abs(observed.durationSec - 1) <= 1 / 48000, 'Chromium duration mismatch')
    assert(observed.seekableStartSec === 0, 'Chromium seekable range did not start at zero')
    assert(observed.seekableEndSec >= 1 - 1 / 48000, 'Chromium seekable range was incomplete')
    const seekTargets = [0.25, 0.9, 0.99, 0]
    assert(observed.seekedSec.length === seekTargets.length, 'Chromium did not finish every seek')
    observed.seekedSec.forEach((actual, index) => {
      assert(Math.abs(actual - seekTargets[index]!) <= 0.01, `Chromium seek ${index} missed target`)
    })
    assert(observed.sameAudioElement, 'view replacement remounted the audio element')
    assert(
      observed.navigationEndSec >= observed.navigationStartSec + 0.08,
      'playback time did not continue across view replacement'
    )

    const probe = await pauseResumeSeekProbe()
    assert(probe.mediaErrorCode === null, `media error ${probe.mediaErrorCode} during pause/seek`)
    assert(probe.resumed, 'playback did not resume after pause')
    assert(probe.afterSeekPlays, `playback stalled after seeking to ${probe.seekTargetSec}s`)
  } finally {
    protocol.unhandle(SCHEME)
    await rm(root, { recursive: true, force: true })
  }
}

// Probe windows come and go; without this Electron's default quit on
// window-all-closed exits 0 mid-run and the harness reads it as a pass.
app.on('window-all-closed', () => {})

void app
  .whenReady()
  .then(run)
  .then(() => {
    console.log('media protocol integration: ok')
    app.exit(0)
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    app.exit(1)
  })
