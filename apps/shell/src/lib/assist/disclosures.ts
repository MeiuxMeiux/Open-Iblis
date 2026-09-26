// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Disclosure copy shared by Settings and the confirm step, so the text the
// user acknowledged is the text shown before each request.
export const OPENROUTER_DISCLOSURE =
  'OpenRouter may route a request across model providers. Iblis requests use only the ' +
  'selected model with provider fallback disabled, and ask OpenRouter to skip providers that ' +
  'retain prompts. The model and routing policy are shown before each submission.'

export const OPENROUTER_ROUTING = 'This model only; provider fallback off; no prompt retention'

export const LOCAL_DISCLOSURE =
  'Runs on this computer. Your brief goes only to the model server on the loopback address ' +
  'and port set in Settings, Local model. No cost and no cloud service.'
