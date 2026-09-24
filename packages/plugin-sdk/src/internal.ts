// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// Helpers shared by the validators. Not re-exported from index.ts.

// A comparison key for an untrusted JSON value (duplicate-id checks, set
// membership). String() would throw on an object such as {"toString": ""};
// validators must refuse input, never throw on it. Non-scalars get a key no
// string can equal, and are reported by the field's own check.
export function scalarKey(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `\u0000${typeof value}`
}

// Win32 path normalization drops trailing dots and spaces from a name, so
// `.. ` or `bin.` would not name what the validator saw. `.` stays legal.
export function trimmedByWindows(segment: string): boolean {
  return segment !== '.' && segment !== '' && /[. ]$/.test(segment)
}
