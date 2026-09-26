// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Text generation for the Create helpers (song ideas, lyrics). One request per
// task may be in flight; a duplicate is refused and Cancel aborts the current
// one. OpenRouter requests carry the user's sealed key and a routing policy
// with provider fallback off; local requests go only to the checked loopback
// base. Replies are bounded, parsed, and sanitized before the renderer sees
// them, and failures surface only as fixed, calm messages.
import { app } from 'electron'
import type { CloudProvidersSnapshot } from '../../../shared/cloud-providers'
import type {
  AssistOptions,
  AssistOutcome,
  AssistProviderOption,
  AssistRequest,
  AssistTask
} from '../../../shared/text-assist'
import { assistMessages, cleanOutput, MAX_TOKENS } from '../../../shared/assist-prompts'
import { log } from '../logger'
import { errorMessage } from '../error-message'
import { cloudProviderHost, type CloudProviderHost } from './index'
import { AssistCancelled, AssistError, requestJson } from './http'
import {
  createLocalModelHost,
  createLocalStore,
  LOCAL_LABEL,
  loopbackUrl,
  type LocalModelHost
} from './local'

const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions'
const GENERATE_TIMEOUT_MS = 120_000
const GENERATE_MAX_BYTES = 256 * 1024
const TASK_LABELS: Record<AssistTask, string> = {
  'song-ideas': 'Song ideas',
  'lyrics-assistance': 'Lyrics assistance'
}

export interface TextAssist {
  local: LocalModelHost
  options(task: AssistTask): Promise<AssistOptions>
  generate(request: AssistRequest): Promise<AssistOutcome>
  cancel(task: AssistTask): void
}

function openRouterOption(
  snapshot: CloudProvidersSnapshot,
  task: AssistTask
): AssistProviderOption {
  const provider = snapshot.providers.find((candidate) => candidate.id === 'openrouter')
  const models = snapshot.models
    .filter((model) => model.provider === 'openrouter' && model.outputModalities.includes('text'))
    .map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.price?.inputPerMillion === undefined
        ? {}
        : { inputPerMillion: model.price.inputPerMillion }),
      ...(model.price?.outputPerMillion === undefined
        ? {}
        : { outputPerMillion: model.price.outputPerMillion }),
      free: model.free
    }))
  const where = 'in Settings, Cloud providers.'
  let reason: string | undefined
  if (!provider || provider.status === 'adapter-unavailable')
    reason = 'Install the OpenRouter adapter from Plugins.'
  else if (provider.status === 'secure-storage-unavailable')
    reason = 'Secure key storage is unavailable on this system.'
  else if (!provider.enabled) reason = `Enable OpenRouter ${where}`
  else if (!provider.hasKey) reason = `Add an OpenRouter key ${where}`
  else if (!provider.consented || !provider.tasks[task])
    reason = `Turn on ${TASK_LABELS[task]} for OpenRouter ${where}`
  else if (models.length === 0) reason = `Refresh OpenRouter models ${where}`
  const defaultModel = snapshot.defaults[task]
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    available: reason === undefined,
    ...(reason ? { reason } : {}),
    models,
    ...(defaultModel && models.some((model) => model.id === defaultModel) ? { defaultModel } : {})
  }
}

function sentence(message: string): string {
  const text = message.slice(0, 180)
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${text.endsWith('.') ? '' : '.'}`
}

// OpenAI chat shape: choices[0].message.content as a string.
function replyText(raw: unknown): string {
  const choices = (raw as { choices?: unknown } | null)?.choices
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined
  const content = (first as { message?: { content?: unknown } } | undefined)?.message?.content
  if (typeof content !== 'string') {
    throw new AssistError('The model sent a reply Iblis could not read. Try another model.')
  }
  return content
}

export function createTextAssist(deps: {
  cloud: CloudProviderHost
  local: LocalModelHost
  fetch?: typeof fetch
}): TextAssist {
  const request = deps.fetch ?? fetch
  const inflight = new Map<AssistTask, AbortController>()

  async function openRouter(req: AssistRequest, signal: AbortSignal): Promise<unknown> {
    // The host's gating errors are fixed strings (never the key); keep them.
    const key = await deps.cloud.textKey(req.task).catch((error: unknown) => {
      throw new AssistError(sentence(errorMessage(error)))
    })
    const snapshot = await deps.cloud.snapshot()
    if (!openRouterOption(snapshot, req.task).models.some((model) => model.id === req.model)) {
      throw new AssistError('Pick a model from the OpenRouter registry.')
    }
    return requestJson({
      fetch: request,
      url: OPENROUTER_CHAT,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        model: req.model,
        messages: assistMessages(req),
        max_tokens: MAX_TOKENS[req.task],
        temperature: 0.9,
        stream: false,
        // Only the chosen model, no silent provider fallback, and only
        // providers that do not retain prompts.
        provider: { allow_fallbacks: false, data_collection: 'deny' }
      }),
      timeoutMs: GENERATE_TIMEOUT_MS,
      maxBytes: GENERATE_MAX_BYTES,
      label: 'OpenRouter',
      local: false,
      signal
    })
  }

  async function local(req: AssistRequest, signal: AbortSignal): Promise<unknown> {
    const base = await deps.local.endpoint(req.model)
    return requestJson({
      fetch: request,
      url: loopbackUrl(`${base}/v1/chat/completions`).href,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: assistMessages(req),
        max_tokens: MAX_TOKENS[req.task],
        temperature: 0.9,
        stream: false
      }),
      timeoutMs: GENERATE_TIMEOUT_MS,
      maxBytes: GENERATE_MAX_BYTES,
      label: LOCAL_LABEL,
      local: true,
      signal
    })
  }

  return {
    local: deps.local,
    async options(task) {
      return {
        task,
        running: inflight.has(task),
        providers: [openRouterOption(await deps.cloud.snapshot(), task), await deps.local.option()]
      }
    },
    async generate(req) {
      if (inflight.has(req.task)) {
        throw new Error('This helper is already writing. Wait for it or press Cancel.')
      }
      const ctrl = new AbortController()
      inflight.set(req.task, ctrl)
      try {
        const raw =
          req.provider === 'openrouter'
            ? await openRouter(req, ctrl.signal)
            : await local(req, ctrl.signal)
        if (ctrl.signal.aborted) return { status: 'cancelled' }
        const { text, truncated } = cleanOutput(req.task, replyText(raw))
        if (!text)
          throw new AssistError(
            'The model returned no usable text. Try again or pick another model.'
          )
        if (req.provider === 'local') await deps.local.rememberModel(req.model)
        return { status: 'done', text, provider: req.provider, model: req.model, truncated }
      } catch (error) {
        if (error instanceof AssistCancelled || ctrl.signal.aborted) return { status: 'cancelled' }
        if (error instanceof AssistError) throw error
        // Anything else is unexpected and is reported without its text.
        log('warn', 'text assist failed', { component: 'text-assist', provider: req.provider })
        // eslint-disable-next-line preserve-caught-error -- the cause is withheld on purpose
        throw new Error('The helper could not finish. Try again.')
      } finally {
        inflight.delete(req.task)
      }
    },
    cancel(task) {
      inflight.get(task)?.abort()
    }
  }
}

let assist: TextAssist | null = null

export function initializeTextAssist(): void {
  if (assist) return
  assist = createTextAssist({
    cloud: cloudProviderHost(),
    local: createLocalModelHost({ store: createLocalStore(app.getPath('userData')) })
  })
}

export function textAssist(): TextAssist {
  if (!assist) throw new Error('text assistance is not initialized')
  return assist
}
