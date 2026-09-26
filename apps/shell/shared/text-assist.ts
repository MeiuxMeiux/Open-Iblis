// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Text assistance for Create: song ideas for the prompt and lyrics for the
// lyrics box, from OpenRouter (user-owned key) or a model server on this
// computer. Main owns every request; the renderer sends a short brief and gets
// back bounded, sanitized text plus an outcome. Keys, URLs, and raw replies
// never cross this boundary.
import type { IpcResult } from './contract'

export type AssistTask = 'song-ideas' | 'lyrics-assistance'
export type TextProviderId = 'openrouter' | 'local'

export const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'] as const
export type LocalHost = (typeof LOCAL_HOSTS)[number]

interface LyricsBrief {
  topic: string
  mood: string
  language: string
  structure: string
}

interface IdeaBrief {
  seed: string
}

export type AssistRequest =
  | { task: 'lyrics-assistance'; provider: TextProviderId; model: string; brief: LyricsBrief }
  | { task: 'song-ideas'; provider: TextProviderId; model: string; brief: IdeaBrief }

export type AssistOutcome =
  | { status: 'done'; text: string; provider: TextProviderId; model: string; truncated: boolean }
  | { status: 'cancelled' }

export interface AssistModelOption {
  id: string
  name: string
  // OpenRouter's reported per-million-token prices; absent for local models.
  inputPerMillion?: number
  outputPerMillion?: number
  free: boolean
}

export interface AssistProviderOption {
  id: TextProviderId
  name: string
  available: boolean
  // Why the provider cannot be used yet, phrased as the next GUI step.
  reason?: string
  models: AssistModelOption[]
  defaultModel?: string
}

export interface AssistOptions {
  task: AssistTask
  running: boolean
  providers: AssistProviderOption[]
}

export interface LocalModelView {
  enabled: boolean
  host: LocalHost
  port: number
  models: string[]
  lastModel?: string
  lastError?: string
  lastCheckedAt?: number
}

export interface TextAssistApi {
  textAssist: {
    options: (task: AssistTask) => Promise<IpcResult<AssistOptions>>
    generate: (request: AssistRequest) => Promise<IpcResult<AssistOutcome>>
    cancel: (task: AssistTask) => Promise<IpcResult<null>>
  }
  localModel: {
    snapshot: () => Promise<IpcResult<LocalModelView>>
    configure: (host: LocalHost, port: number) => Promise<IpcResult<LocalModelView>>
    setEnabled: (enabled: boolean) => Promise<IpcResult<LocalModelView>>
    test: () => Promise<IpcResult<LocalModelView>>
  }
}
