// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { IblisApi } from '../shared/contract'

declare global {
  interface Window {
    iblis: IblisApi
  }
}

export {}
