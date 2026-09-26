// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Track-detail value formatting, kept out of the drawer component.

export function seconds(value?: number): string {
  return value === undefined ? 'Unavailable' : `${value.toFixed(3)} s`
}

export function bytes(value?: number): string {
  if (value === undefined) return 'Unavailable'
  return `${(value / 1024 / 1024).toFixed(2)} MiB (${value.toLocaleString()} bytes)`
}
