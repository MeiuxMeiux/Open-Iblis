// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared client-side filter state for the Styles section. Each section maps
// its own items onto categories/origins and asks these helpers whether a row
// survives the current header filters.
import type { TrainingCategory } from '../../../shared/training'

export type StyleCategoryTab = 'all' | 'texture' | 'groove' | 'other'
export type StyleOriginChip = 'trained' | 'community' | 'experimental'

export interface StyleFilters {
  query: string
  category: StyleCategoryTab
  origins: StyleOriginChip[]
}

export function matchesQuery(filters: StyleFilters, haystack: string[]): boolean {
  const query = filters.query.trim().toLowerCase()
  if (!query) return true
  return haystack.some((text) => text.toLowerCase().includes(query))
}

// Items with no training category (curated offers, imports) live under Other.
export function matchesCategory(filters: StyleFilters, categories: TrainingCategory[]): boolean {
  if (filters.category === 'all') return true
  if (filters.category === 'other') return categories.length === 0
  return categories.includes(filters.category)
}

// No selected chips means no origin restriction.
export function matchesOrigin(filters: StyleFilters, origins: StyleOriginChip[]): boolean {
  if (filters.origins.length === 0) return true
  return origins.some((origin) => filters.origins.includes(origin))
}

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
