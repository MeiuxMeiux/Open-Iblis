// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// One bounded JSON request for the text helpers: redirects refused, a hard
// time limit, a byte cap enforced while streaming the body, and an optional
// user cancel. Every failure becomes an AssistError with a calm, fixed
// message; no URL, header, key, or response text ever reaches it.

// A message that is safe to show the user as-is.
export class AssistError extends Error {}

// The user pressed Cancel; the caller reports it as an outcome, not an error.
export class AssistCancelled extends Error {}

export interface BoundedRequest {
  fetch: typeof fetch
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  timeoutMs: number
  maxBytes: number
  // Display name for messages ("OpenRouter", "The local model server").
  label: string
  local: boolean
  signal?: AbortSignal
}

function statusMessage(status: number, label: string, local: boolean): string {
  if (status === 401 || status === 403) {
    return local
      ? `${label} refused the request.`
      : `${label} did not accept the saved key. Replace it in Settings, Cloud providers.`
  }
  if (status === 402) return `${label} reports too few credits for this model.`
  if (status === 404) {
    return local
      ? `${label} does not offer this model or an OpenAI-compatible endpoint on that port.`
      : `${label} has no provider for this model under the no-fallback, no-retention policy. Pick another model.`
  }
  if (status === 408 || status === 504) return `${label} took too long to answer.`
  if (status === 413) return `${label} found the request too long.`
  if (status === 429) return `${label} is limiting requests right now. Wait a moment and try again.`
  if (status >= 500) return `${label} is unavailable right now. Try again later.`
  return `${label} could not complete the request (HTTP ${String(status)}).`
}

function networkMessage(error: unknown, label: string, local: boolean): string {
  const cause = (error as { cause?: { message?: unknown } } | null)?.cause?.message
  if (typeof cause === 'string' && /redirect/i.test(cause)) {
    return `${label} answered with a redirect, which Iblis refuses.`
  }
  return local
    ? `Nothing answered on the port you set. Start Ollama, LM Studio, or llama-server and try again.`
    : `Could not reach ${label}. Check your connection and try again.`
}

async function readBounded(response: Response, maxBytes: number, label: string): Promise<string> {
  const tooLarge = `${label} sent a reply larger than Iblis accepts.`
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) throw new AssistError(tooLarge)
  if (!response.body) return ''
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new AssistError(tooLarge)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function requestJson(req: BoundedRequest): Promise<unknown> {
  const ctrl = new AbortController()
  const state = { timedOut: false }
  const timer = setTimeout(() => {
    state.timedOut = true
    ctrl.abort()
  }, req.timeoutMs)
  const cancel = (): void => ctrl.abort()
  req.signal?.addEventListener('abort', cancel, { once: true })
  if (req.signal?.aborted) ctrl.abort()
  try {
    let response: Response
    try {
      if (ctrl.signal.aborted) throw new AssistCancelled()
      response = await req.fetch(req.url, {
        method: req.method,
        headers: req.headers,
        ...(req.body === undefined ? {} : { body: req.body }),
        redirect: 'error',
        signal: ctrl.signal
      })
    } catch (error) {
      if (ctrl.signal.aborted) throw error
      throw new AssistError(networkMessage(error, req.label, req.local))
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new AssistError(`${req.label} answered with a redirect, which Iblis refuses.`)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new AssistError(statusMessage(response.status, req.label, req.local))
    }
    const raw = await readBounded(response, req.maxBytes, req.label)
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new AssistError(`${req.label} sent a reply Iblis could not read.`)
    }
  } catch (error) {
    if (req.signal?.aborted) throw new AssistCancelled()
    if (state.timedOut) throw new AssistError(`${req.label} took too long to answer.`)
    if (error instanceof AssistError) throw error
    throw new AssistError(`${req.label} could not complete the request.`)
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', cancel)
  }
}
