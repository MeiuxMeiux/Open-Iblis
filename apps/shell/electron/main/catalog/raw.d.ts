// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The baked-in catalog public key is imported as raw text so there is a single
// committed source of truth (electron/main/keys/catalog.pub.pem) and the bytes
// land inside the bundled main chunk — no file to ship alongside the binary.
declare module '*.pem?raw' {
  const content: string
  export default content
}
