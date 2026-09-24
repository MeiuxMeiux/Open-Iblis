// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure mapping from adapter-library records to Create picker entries.
import type { ImportedAdapterRecord } from '../../../shared/adapters'
import { styleRegistryName } from '../../../shared/styles'

export interface PickerEntry {
  record: ImportedAdapterRecord
  registryName: string
  category: 'Texture' | 'Groove' | 'Other'
  originLabel: string
  loaded: boolean
}

function categoryOf(record: ImportedAdapterRecord): PickerEntry['category'] {
  const name = record.displayName.toLowerCase()
  if (name.includes('texture')) return 'Texture'
  if (name.includes('groove')) return 'Groove'
  return 'Other'
}

function originOf(record: ImportedAdapterRecord): string {
  if (record.origin === 'yours') return 'Yours'
  if (record.origin === 'downloaded') return 'Community'
  if (record.sourceOfferId) return 'Community'
  return 'Imported'
}

export function pickerEntries(
  records: ImportedAdapterRecord[],
  liveAdapters: string[] | null,
  query: string
): PickerEntry[] {
  const needle = query.trim().toLowerCase()
  return records
    .filter((record) => record.format === 'safetensors')
    .map((record) => {
      const registryName = styleRegistryName(record.displayName, record.sha256)
      return {
        record,
        registryName,
        category: categoryOf(record),
        originLabel: originOf(record),
        loaded: liveAdapters?.includes(registryName) ?? false
      }
    })
    .filter(
      (entry) =>
        !needle ||
        entry.record.displayName.toLowerCase().includes(needle) ||
        entry.originLabel.toLowerCase().includes(needle)
    )
}
