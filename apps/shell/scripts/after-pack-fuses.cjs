// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// electron-builder afterPack hook: flip Electron fuses on the packaged binary.
// This closes the "use the shipped runtime as a debugger/generic Node" holes
// without an obfuscation arms race (docs/admin/00-overview.md threat model):
//   - Node CLI inspect args off: no --inspect/--inspect-brk against the app.
//   - NODE_OPTIONS off: no environment-injected preload scripts.
//   - OnlyLoadAppFromAsar on: the app only boots from app.asar, so a dropped
//     plain "app" folder cannot shadow the packaged code.
// RunAsNode stays ON deliberately: .js/.cjs sidecar plugins launch through the
// shell binary with ELECTRON_RUN_AS_NODE (electron/main/sidecar/spawn.ts).
// EnableEmbeddedAsarIntegrityValidation is deferred until builds are
// code-signed (Charter Open Question 4); without a signature it adds nothing.

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS electron-builder hook */
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const path = require('node:path')

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context
  let binary
  if (electronPlatformName === 'win32') {
    binary = path.join(appOutDir, `${packager.appInfo.productFilename}.exe`)
  } else if (electronPlatformName === 'darwin') {
    const name = packager.appInfo.productFilename
    binary = path.join(appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
  } else {
    binary = path.join(appOutDir, packager.executableName)
  }
  await flipFuses(binary, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
  console.log(`fuses flipped on ${path.basename(binary)}`)
}
