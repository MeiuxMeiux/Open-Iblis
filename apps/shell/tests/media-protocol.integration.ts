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

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { stream: true } }])

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
  protocol.handle(SCHEME, (request) => respondWithLocalFile(request, file))

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
  } finally {
    protocol.unhandle(SCHEME)
    await rm(root, { recursive: true, force: true })
  }
}

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
