// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { ipcMain } from 'electron'
import {
  LOCAL_HOSTS,
  type AssistRequest,
  type AssistTask,
  type LocalHost,
  type TextProviderId
} from '../../shared/text-assist'
import { BRIEF_LIMITS, cleanField, isLyricsStructure } from '../../shared/assist-prompts'
import { textAssist } from './cloud-providers/generate'
import { validPort } from './cloud-providers/local'
import { guardAsync } from './ipc-guard'

function assistTask(value: unknown): AssistTask {
  if (value === 'song-ideas' || value === 'lyrics-assistance') return value
  throw new Error('invalid assistance task')
}

function textProvider(value: unknown): TextProviderId {
  if (value === 'openrouter' || value === 'local') return value
  throw new Error('invalid text provider')
}

function field(raw: Record<string, unknown> | null, name: keyof typeof BRIEF_LIMITS): string {
  const value = raw?.[name] ?? ''
  if (typeof value !== 'string' || value.length > 4 * BRIEF_LIMITS[name]) {
    throw new Error(`invalid ${name}`)
  }
  return cleanField(value, BRIEF_LIMITS[name])
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// The renderer's brief is untrusted: every field is shape-checked, cleaned of
// control characters, and bounded before a prompt is built from it.
export function assistRequest(value: unknown): AssistRequest {
  const raw = record(value)
  const task = assistTask(raw?.task)
  const provider = textProvider(raw?.provider)
  const model = raw?.model
  if (typeof model !== 'string' || !model || model.length > 180) {
    throw new Error('pick a model first')
  }
  const brief = record(raw.brief)
  if (task === 'song-ideas') {
    return { task, provider, model, brief: { seed: field(brief, 'seed') } }
  }
  const topic = field(brief, 'topic')
  if (!topic) throw new Error('describe what the song is about')
  const structure = brief?.structure
  if (typeof structure !== 'string' || !isLyricsStructure(structure)) {
    throw new Error('invalid lyrics structure')
  }
  return {
    task,
    provider,
    model,
    brief: { topic, mood: field(brief, 'mood'), language: field(brief, 'language'), structure }
  }
}

function localHost(value: unknown): LocalHost {
  if (typeof value === 'string' && (LOCAL_HOSTS as readonly string[]).includes(value)) {
    return value as LocalHost
  }
  throw new Error('the local model address must be on this computer')
}

function enabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  throw new Error('invalid enabled value')
}

export function registerTextAssistIpc(): void {
  ipcMain.handle('text-assist:options', (_e, rawTask: unknown) =>
    guardAsync(() => textAssist().options(assistTask(rawTask)))
  )
  ipcMain.handle('text-assist:generate', (_e, rawRequest: unknown) =>
    guardAsync(() => textAssist().generate(assistRequest(rawRequest)))
  )
  ipcMain.handle('text-assist:cancel', (_e, rawTask: unknown) =>
    guardAsync(() => {
      textAssist().cancel(assistTask(rawTask))
      return Promise.resolve(null)
    })
  )
  ipcMain.handle('local-model:snapshot', () => guardAsync(() => textAssist().local.snapshot()))
  ipcMain.handle('local-model:configure', (_e, rawHost: unknown, rawPort: unknown) =>
    guardAsync(() => {
      const host = localHost(rawHost)
      const port = validPort(rawPort)
      return textAssist().local.configure(host, port)
    })
  )
  ipcMain.handle('local-model:set-enabled', (_e, rawEnabled: unknown) =>
    guardAsync(() => {
      const isEnabled = enabled(rawEnabled)
      return textAssist().local.setEnabled(isEnabled)
    })
  )
  ipcMain.handle('local-model:test', () => guardAsync(() => textAssist().local.test()))
}
