// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { protocol } from 'electron'

// All renderer-readable local media schemes are declared together because
// Electron requires privileged schemes to be registered before app ready.
//
// standard is load-bearing for playback, not cosmetic: without it Chromium's
// media loader mishandles partial ranges from protocol.handle - the buffered
// range can freeze after a pause (endless "Buffering") and a seek past it
// kills the pipeline with MEDIA_ERR_NETWORK "FFmpegDemuxer: data source
// error". Covered by tests/media-protocol.integration.ts (just
// shell-media-test), which registers its scheme with these same privileges.
export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'iblis-track', privileges: { standard: true, stream: true } },
    { scheme: 'iblis-probe', privileges: { standard: true, stream: true } },
    { scheme: 'iblis-stem', privileges: { standard: true, stream: true } }
  ])
}
