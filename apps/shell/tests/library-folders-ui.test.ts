// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { folderDisplayName } from '../src/lib/library/folder-label'

const root = resolve(__dirname, '..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

describe('Library folder organizer surface', () => {
  it('disambiguates preserved legacy folders from virtual filters', () => {
    expect(folderDisplayName('No folder')).toBe('No folder (user folder)')
    expect(folderDisplayName('ALL TRACKS')).toBe('ALL TRACKS (user folder)')
    expect(folderDisplayName('Drafts')).toBe('Drafts')
  })

  it('keeps folder metadata and mutations behind the typed path-free bridge', () => {
    const contract = read('shared/contract.ts')
    const library = read('shared/library.ts')
    const preload = read('electron/preload/index.ts')
    const ipc = read('electron/main/ipc-library.ts')

    expect(library).toContain('export interface LibraryFolder')
    expect(library).toContain('folderId?: string')
    for (const method of [
      'folders:',
      'folderCreate:',
      'folderRename:',
      'folderRemove:',
      'moveToFolder:'
    ]) {
      expect(contract).toContain(method)
    }
    for (const channel of [
      'library:folders',
      'library:folder-create',
      'library:folder-rename',
      'library:folder-remove',
      'library:move-to-folder'
    ]) {
      expect(preload).toContain(channel)
      expect(ipc).toContain(channel)
    }
    expect(contract).not.toContain('folderPath')
  })

  it('provides named filters, folder CRUD, and per-track filing controls', () => {
    const sidebar = read('src/lib/library/FolderSidebar.svelte')
    const folderRow = read('src/lib/library/FolderRow.svelte')
    const trackRow = read('src/lib/library/TrackRow.svelte')
    const view = read('src/lib/views/Library.svelte')
    const queueHistory = read('src/lib/queue/QueueHistory.svelte')
    const libraryState = read('src/lib/library.svelte.ts')
    const libraryStyles = read('src/lib/library/library-view.css')
    const viewOptions = read('src/lib/library/LibraryViewOptions.svelte')

    expect(sidebar).toContain('<nav aria-label="Library folders">')
    expect(sidebar).toContain('<span>All tracks</span>')
    expect(sidebar).toContain('<span>No folder</span>')
    expect(sidebar).toContain('aria-label="Add folder"')
    expect(sidebar).toContain('aria-disabled={!newName.trim() || creating}')
    expect(sidebar).toContain('aria-live="polite"')
    expect(sidebar).toContain('Folder ${folder.name} created.')
    expect(folderRow).toContain('aria-label={`Rename folder ${displayName}`}')
    expect(folderRow).toContain('tracks move to No folder')
    expect(folderRow).toContain('renameAction?.focus()')
    expect(folderRow).toContain('onblur={() => void commit(false)}')
    expect(folderRow).toContain('void commit(true)')

    expect(trackRow).toContain('aria-label={`Folder for ${track.name}`}')
    expect(trackRow).toContain('<option value="">No folder</option>')
    expect(trackRow).toContain('folderDisplayName(folder.name)')
    expect(trackRow).toContain("origin.closest('button, input, select, label')")
    expect(trackRow).toContain('const busy = $derived(removing || deleting)')
    expect(trackRow).toContain('disabled={movingFolder || busy}')
    expect(trackRow).toContain('draggable={!busy}')
    expect(trackRow).toContain('display.showTargetMetadata && target.bpm')
    expect(trackRow).toContain('display.showSeed && track.seed !== undefined')
    expect(trackRow).not.toContain('{#if track.seed !== undefined}')
    expect(view).toContain('const visibleTracks = $derived.by')
    expect(view).toContain('<LibraryViewOptions')
    expect(view).toContain('matchesTrackQuery(track, trackQuery)')
    expect(view).toContain('placeholder="Search tracks"')
    expect(viewOptions).toContain('label="Seed"')
    expect(view).toContain('removing={library.isRemoving(track.id)}')
    expect(view).toContain('onmove={(folderId?: string) => fileTrack(track, folderId)}')
    expect(view).toContain('onremove={() => removeTrack(track)}')
    expect(queueHistory.match(/disabled=\{library\.isRemoving\(result\.id\)\}/g)).toHaveLength(3)
    expect(libraryState).toContain('if (removingIds.includes(id)) return')
    expect(libraryState).toContain('tracks = tracks.filter((track) => track.id !== id)')
    expect(libraryState).toContain('player.updateTracks(tracks)')
    expect(libraryStyles).toContain('@media (max-width: 1080px)')
    expect(view).not.toContain('unloadIfActive')
  })

  it('rejects late detail and Remix responses after newer user intent', () => {
    const view = read('src/lib/views/Library.svelte')
    const sidebar = read('src/lib/library/FolderSidebar.svelte')
    const detail = read('src/lib/library/TrackDetailModal.svelte')

    expect(view).toContain('const request = ++remixRequest')
    expect(view).toContain('if (request !== remixRequest) return')
    expect(detail).toContain('const current = ++request')
    expect(detail).toContain('if (current !== request) return')
    expect(view).toContain('onDestroy(() => {')
    expect(detail).toContain('request++')
    const detailHandler = view.slice(
      view.indexOf('function openDetail'),
      view.indexOf('function closeDetail')
    )
    const deleteHandler = view.slice(
      view.indexOf('async function removeTrack'),
      view.indexOf('async function showAllTracks')
    )
    expect(detailHandler).toContain('remixRequest++')
    expect(detail).toContain('processors.retry(id, capability)')
    expect(deleteHandler).toContain('remixRequest++')
    expect(sidebar).toContain('const startingFilter = filter')
    expect(sidebar).toContain('if (filter === startingFilter)')
    expect(sidebar).not.toContain('JSON.stringify(filter)')
  })
})
