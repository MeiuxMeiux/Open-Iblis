// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// SemVer precedence comparison for installed plugin ordering and host minimums.
// Build metadata is ignored; numeric prerelease identifiers compare numerically
// and sort below non-numeric identifiers, per semver.org.
export function compareSemver(a: string, b: string): number {
  const [precedenceA = a] = a.split('+', 1)
  const [precedenceB = b] = b.split('+', 1)
  const dashA = precedenceA.indexOf('-')
  const dashB = precedenceB.indexOf('-')
  const releaseA = dashA < 0 ? precedenceA : precedenceA.slice(0, dashA)
  const releaseB = dashB < 0 ? precedenceB : precedenceB.slice(0, dashB)
  const prereleaseA = dashA < 0 ? undefined : precedenceA.slice(dashA + 1)
  const prereleaseB = dashB < 0 ? undefined : precedenceB.slice(dashB + 1)
  const coreA = releaseA.split('.').map(Number)
  const coreB = releaseB.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (coreA[i] ?? 0) - (coreB[i] ?? 0)
    if (d !== 0) return d
  }
  if (prereleaseA === undefined || prereleaseB === undefined) {
    if (prereleaseA === prereleaseB) return 0
    return prereleaseA === undefined ? 1 : -1
  }

  const idsA = prereleaseA.split('.')
  const idsB = prereleaseB.split('.')
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
    const idA = idsA[i]
    const idB = idsB[i]
    if (idA === undefined || idB === undefined) return idA === undefined ? -1 : 1
    if (idA === idB) continue
    const numericA = /^\d+$/.test(idA)
    const numericB = /^\d+$/.test(idB)
    if (numericA && numericB) {
      const normalizedA = idA.replace(/^0+(?=\d)/, '')
      const normalizedB = idB.replace(/^0+(?=\d)/, '')
      if (normalizedA.length !== normalizedB.length) return normalizedA.length - normalizedB.length
      return normalizedA < normalizedB ? -1 : 1
    }
    if (numericA !== numericB) return numericA ? -1 : 1
    return idA < idB ? -1 : 1
  }
  return 0
}
