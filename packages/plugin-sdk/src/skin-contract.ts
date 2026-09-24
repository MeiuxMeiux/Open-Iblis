// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// SkinContract — the closed vocabulary of design tokens. The shell, every
// UI primitive, every plugin component, and every skin consume the SAME set.
// No view or plugin may hardcode a color/font/radius/shadow/spacing — it must
// reference a token. Skins redefine tokens; that is the whole orthogonality
// guarantee (a skin authored before a plugin still styles it). Keep in sync
// with docs/feature/skins.md "Token vocabulary".

export const SKIN_TOKENS = [
  'color.bg.base',
  'color.bg.elevated',
  'color.bg.subtle',
  'color.bg.inset',
  'color.text.primary',
  'color.text.secondary',
  'color.text.muted',
  'color.text.inverse',
  'color.border.subtle',
  'color.border.default',
  'color.border.strong',
  'color.accent',
  'color.state.danger',
  'color.state.warning',
  'color.state.success',
  'color.state.info',
  'radius.none',
  'radius.sm',
  'radius.md',
  'radius.lg',
  'radius.full',
  'shadow.sm',
  'shadow.md',
  'shadow.lg',
  'space.0',
  'space.1',
  'space.2',
  'space.3',
  'space.4',
  'space.5',
  'space.6',
  'space.8',
  'space.12',
  'font.family.ui',
  'font.family.mono',
  'font.family.display',
  'font.size.xs',
  'font.size.sm',
  'font.size.body',
  'font.size.md',
  'font.size.lg',
  'font.size.xl',
  'font.size.display',
  'font.weight.regular',
  'font.weight.medium',
  'font.weight.semibold',
  'font.weight.bold',
  'motion.duration-fast',
  'motion.duration-base',
  'motion.ease-standard',
  'wave.fg',
  'wave.bg',
  'wave.peak',
  'wave.playhead'
] as const

export type SkinToken = (typeof SKIN_TOKENS)[number]

// A skin need not define every token; unset tokens inherit from `extends`
// (or the base skin).
export type SkinTokens = Partial<Record<SkinToken, string>>

export interface SkinDescriptor {
  id: string
  name: string
  version: string
  extends?: string
  theme?: 'dark' | 'light'
  tokens: SkinTokens
  // Optional extras.css path (relative to the skin folder), loaded after tokens.
  css?: string
}

const KNOWN = new Set<string>(SKIN_TOKENS)

export const isSkinToken = (v: unknown): v is SkinToken => typeof v === 'string' && KNOWN.has(v)

// Map a dotted token name to its CSS custom property: color.bg.base -> --color-bg-base.
export const tokenToCssVar = (token: SkinToken): string => `--${token.replace(/\./g, '-')}`

// Return any token keys present in `tokens` that are not part of the contract.
export const unknownSkinTokens = (tokens: Record<string, unknown>): string[] =>
  Object.keys(tokens).filter((k) => !KNOWN.has(k))
