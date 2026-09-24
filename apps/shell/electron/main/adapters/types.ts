// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ImportedAdapterRecord } from '../../../shared/adapters'

export type {
  AdapterImportDisclosure,
  ImportedAdapterFile,
  ImportedAdapterFormat,
  ImportedAdapterRecord
} from '../../../shared/adapters'

export const ADAPTER_LIBRARY_VERSION = 1 as const
export const MAX_ADAPTER_BYTES = 1024 * 1024 * 1024
export const MAX_ADAPTER_CONFIG_BYTES = 1024 * 1024

export interface AdapterLibraryDocument {
  version: typeof ADAPTER_LIBRARY_VERSION
  adapters: ImportedAdapterRecord[]
}
