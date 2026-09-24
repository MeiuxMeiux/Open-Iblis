// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { protocol } from 'electron'
import { respondWithLocalFile } from '../media/file'
import {
  actionsProbeMediaPath,
  type ActionsProbeMediaKind
} from './drivers/ace-compat/actions-probe'

const ALLOWED_MEDIA = new Set<ActionsProbeMediaKind>(['source', 'result'])

export function registerActionsProbeProtocol(): void {
  protocol.handle('iblis-probe', (request) => {
    const kind = new URL(request.url).hostname as ActionsProbeMediaKind
    if (!ALLOWED_MEDIA.has(kind)) {
      return Promise.resolve(
        new Response(null, { status: 404, headers: { 'Content-Length': '0' } })
      )
    }
    return respondWithLocalFile(request, actionsProbeMediaPath(kind))
  })
}
