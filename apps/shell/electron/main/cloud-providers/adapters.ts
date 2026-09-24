// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CloudProviderId, ModelSummaryV1 } from '../../../shared/cloud-providers'

export const PROVIDER_NAMES: Record<CloudProviderId, string> = {
  openrouter: 'OpenRouter',
  imagerouter: 'ImageRouter'
}

const MAX_MODELS = 500
const MAX_TEXT = 180
const MAX_LIST = 24

export const modelUrl = (provider: CloudProviderId): string =>
  provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/models'
    : 'https://api.imagerouter.io/v1/models?output_modalities=image&limit=500'

function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.length <= MAX_TEXT)
        .slice(0, MAX_LIST)
    : []
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function decimal(value: unknown): number | undefined {
  if (typeof value === 'number') return number(value)
  if (typeof value !== 'string' || value.length > 40) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function free(price: ModelSummaryV1['price']): boolean {
  if (!price) return false
  return Object.values(price).every((value) => value === 0)
}

function openRouter(value: unknown): ModelSummaryV1 | null {
  const raw = object(value)
  const id = raw && text(raw.id)
  if (!raw || !id) return null
  const architecture = object(raw.architecture)
  const topProvider = object(raw.top_provider)
  const input = strings(architecture?.input_modalities)
  const output = strings(architecture?.output_modalities)
  if (!output.includes('text')) return null
  const pricing = object(raw.pricing)
  const promptPrice = decimal(pricing?.prompt)
  const completionPrice = decimal(pricing?.completion)
  const price = {
    inputPerMillion: promptPrice === undefined ? undefined : promptPrice * 1_000_000,
    outputPerMillion: completionPrice === undefined ? undefined : completionPrice * 1_000_000
  }
  return {
    schemaVersion: 1,
    provider: 'openrouter',
    id,
    name: text(raw.name) ?? id,
    inputModalities: input,
    outputModalities: output,
    contextWindow: number(raw.context_length),
    maxOutput: number(topProvider?.max_completion_tokens),
    supportedParameters: strings(raw.supported_parameters),
    sizes: [],
    ...(price.inputPerMillion === undefined && price.outputPerMillion === undefined
      ? {}
      : { price }),
    free: free(price),
    privacyLabel: 'No provider fallback by default; routing choice shown before use'
  }
}

function imageRouter(value: unknown): ModelSummaryV1 | null {
  const raw = object(value)
  const id = raw && text(raw.id)
  if (!raw || !id) return null
  const architecture = object(raw.architecture)
  const output = strings(architecture?.output_modalities)
  if (!output.includes('image')) return null
  const pricing = object(raw.pricing)
  const price = {
    min: number(pricing?.min),
    typical: number(pricing?.average),
    max: number(pricing?.max)
  }
  const parameters = object(raw.parameters)
  return {
    schemaVersion: 1,
    provider: 'imagerouter',
    id,
    name: id,
    inputModalities: strings(architecture?.input_modalities),
    outputModalities: output,
    contextWindow: number(raw.context_length),
    supportedParameters: strings(raw.supported_parameters),
    sizes: strings(parameters?.size),
    ...(price.min === undefined && price.typical === undefined && price.max === undefined
      ? {}
      : { price }),
    free: free(price),
    privacyLabel: 'Prompts logged; forwarded to an external image provider'
  }
}

function cachedModel(provider: CloudProviderId, value: unknown): ModelSummaryV1 | null {
  const raw = object(value)
  const id = raw && text(raw.id)
  const name = raw && text(raw.name)
  if (raw?.schemaVersion !== 1 || raw.provider !== provider || !id || !name) return null
  const inputModalities = strings(raw.inputModalities)
  const outputModalities = strings(raw.outputModalities)
  if (provider === 'openrouter' && !outputModalities.includes('text')) return null
  if (provider === 'imagerouter' && !outputModalities.includes('image')) return null
  const rawPrice = object(raw.price)
  const price = {
    inputPerMillion: number(rawPrice?.inputPerMillion),
    outputPerMillion: number(rawPrice?.outputPerMillion),
    min: number(rawPrice?.min),
    typical: number(rawPrice?.typical),
    max: number(rawPrice?.max)
  }
  return {
    schemaVersion: 1,
    provider,
    id,
    name,
    inputModalities,
    outputModalities,
    contextWindow: number(raw.contextWindow),
    maxOutput: number(raw.maxOutput),
    supportedParameters: strings(raw.supportedParameters),
    sizes: strings(raw.sizes),
    ...(Object.values(price).every((item) => item === undefined) ? {} : { price }),
    free: free(price),
    privacyLabel:
      provider === 'openrouter'
        ? 'No provider fallback by default; routing choice shown before use'
        : 'Prompts logged; forwarded to an external image provider'
  }
}

// Raw API shapes are held only inside main, immediately reduced to this
// bounded schema. The renderer never receives descriptions, unknown fields,
// response headers, or a provider URL.
export function normalizeModels(provider: CloudProviderId, raw: unknown): ModelSummaryV1[] {
  const values = Array.isArray(raw)
    ? raw
    : object(raw) && Array.isArray((raw as Record<string, unknown>).data)
      ? ((raw as Record<string, unknown>).data as unknown[])
      : []
  const parse = provider === 'openrouter' ? openRouter : imageRouter
  return values
    .slice(0, MAX_MODELS)
    .map(parse)
    .filter((model): model is ModelSummaryV1 => model !== null)
}

export function normalizeCachedModels(provider: CloudProviderId, raw: unknown): ModelSummaryV1[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, MAX_MODELS)
    .map((model) => cachedModel(provider, model))
    .filter((model): model is ModelSummaryV1 => model !== null)
}
