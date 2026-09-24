<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { InstallProgress, IpcResult, SidecarHealth } from '../../../shared/contract'
  import type {
    PluginInstallQueueEntry,
    PluginInstallQueueSnapshot
  } from '../../../shared/plugin-install-queue'
  import type { ProcessorSettings } from '../../../shared/processors'
  import PluginCard from '../plugins/PluginCard.svelte'
  import PluginInstallManager from '../plugins/PluginInstallManager.svelte'
  import ProcessorProviderCard from '../processors/ProcessorProviderCard.svelte'
  import Icon from '../ui/Icon.svelte'
  import { buildRows, type PluginRow } from '../plugins/version'

  let rows = $state<PluginRow[]>([])
  let processorSettings = $state<ProcessorSettings>({
    defaults: {},
    providers: [],
    acknowledgements: {}
  })
  let filter = $state<'all' | 'analysis'>('all')
  let health = $state<Record<string, SidecarHealth>>({})
  let loading = $state(true)
  let error = $state<string | null>(null)
  let busyIds = $state<Set<string>>(new Set())
  // Live download progress for the plugin currently installing, keyed by id.
  let progress = $state<Record<string, InstallProgress>>({})
  let installQueue = $state<PluginInstallQueueSnapshot>({ entries: [], history: [] })

  // Subscribe once to streamed install progress from main; clear a plugin's
  // entry when it reaches 100% (the run()'s refresh takes over from there).
  $effect(() => {
    const off = window.iblis.plugins.onInstallProgress((p) => {
      progress = { ...progress, [p.id]: p }
    })
    return off
  })

  // The queue belongs to main, so it continues while this tab is hidden and
  // remains correct after a renderer refresh.
  $effect(() => {
    const off = window.iblis.plugins.onInstallQueue((snapshot) => {
      installQueue = snapshot
    })
    return off
  })

  async function refresh(): Promise<void> {
    loading = true
    error = null
    const [cat, inst, hp, processors, queue] = await Promise.all([
      window.iblis.catalog.list(),
      window.iblis.plugins.listInstalled(),
      window.iblis.plugins.health(),
      window.iblis.processors.settings(),
      window.iblis.plugins.installQueue()
    ])
    loading = false
    health = hp.ok ? hp.data : {}
    if (processors.ok) processorSettings = processors.data
    if (queue.ok) installQueue = queue.data
    if (!cat.ok) return void (error = cat.error)
    if (!inst.ok) return void (error = inst.error)
    rows = buildRows(cat.data, inst.data)
  }

  $effect(() => void refresh())

  async function run(id: string, op: () => Promise<IpcResult<unknown>>): Promise<void> {
    busyIds = new Set(busyIds).add(id)
    error = null
    const r = await op()
    const nextBusy = new Set(busyIds)
    nextBusy.delete(id)
    busyIds = nextBusy
    // Drop this plugin's progress bar once the op settles — refresh() repaints
    // the card from on-disk truth (installed version / sidecar health).
    progress = Object.fromEntries(Object.entries(progress).filter(([key]) => key !== id))
    // A user cancel is a clean outcome, not an error to flag in red.
    if (!r.ok && r.error !== 'install cancelled') error = r.error
    await refresh()
  }

  const p = (): typeof window.iblis.plugins => window.iblis.plugins
  const install = (row: PluginRow): Promise<void> =>
    run(row.id, () => p().install(row.id, row.latest))
  const update = (row: PluginRow): Promise<void> =>
    run(row.id, () => p().install(row.id, row.latest))
  const rollback = (row: PluginRow): Promise<void> => run(row.id, () => p().rollback(row.id))
  const remove = (row: PluginRow): Promise<void> => run(row.id, () => p().remove(row.id))
  // Fire-and-forget: the pending install() call resolves itself with the cancel.
  const cancel = (row: PluginRow): void => void p().cancelInstall(row.id)
  const queued = (id: string): PluginInstallQueueEntry | null =>
    installQueue.entries.find((entry) => entry.id === id) ?? null
  const pluginNames = $derived(Object.fromEntries(rows.map((row) => [row.id, row.name])))
  const processorIds = $derived(new Set(processorSettings.providers.map((provider) => provider.id)))
  const visibleRows = $derived(
    rows.filter(
      (row) =>
        !processorIds.has(row.id) && (filter === 'all' || row.analysisCapabilities.length > 0)
    )
  )
</script>

<section class="plugins">
  <header class="bar">
    <h1>Plugins</h1>
    <button class="refresh" disabled={loading} onclick={() => void refresh()}>
      <Icon name="refresh" size={14} />
      <span>Refresh</span>
    </button>
  </header>

  <div class="filters" aria-label="Plugin filters">
    <button
      class:active={filter === 'all'}
      aria-pressed={filter === 'all'}
      onclick={() => (filter = 'all')}>All plugins</button
    >
    <button
      class:active={filter === 'analysis'}
      aria-pressed={filter === 'analysis'}
      onclick={() => (filter = 'analysis')}>Audio analysis</button
    >
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <PluginInstallManager
    snapshot={installQueue}
    {progress}
    names={pluginNames}
    onCancel={(id: string) => void p().cancelInstall(id)}
  />

  {#if loading && rows.length === 0}
    <p class="muted">Loading the catalog…</p>
  {:else if rows.length === 0 && processorSettings.providers.length === 0}
    <p class="muted">No plugins in the catalog yet.</p>
  {:else}
    <div class="list">
      {#each processorSettings.providers as provider (provider.id)}
        {@const row = rows.find((candidate) => candidate.id === provider.id)}
        <ProcessorProviderCard
          {provider}
          headingLevel={2}
          settings={processorSettings}
          onSettings={(next: ProcessorSettings) => (processorSettings = next)}
          busy={busyIds.has(provider.id) || queued(provider.id) !== null}
          queue={queued(provider.id)}
          onUpdate={row &&
          row.latest !== provider.version &&
          !row.installedVersions.includes(row.latest)
            ? () => void update(row)
            : undefined}
          onRollback={row && row.installedVersions.length > 1
            ? () => void rollback(row)
            : undefined}
          onRemove={row ? () => void remove(row) : undefined}
          onCancel={() => void p().cancelInstall(provider.id)}
        />
      {/each}
      {#each visibleRows as row (row.id)}
        <PluginCard
          {row}
          health={health[row.id] ?? null}
          busy={busyIds.has(row.id) || queued(row.id) !== null}
          progress={progress[row.id] ?? null}
          queue={queued(row.id)}
          onInstall={() => void install(row)}
          onUpdate={() => void update(row)}
          onRollback={() => void rollback(row)}
          onRemove={() => void remove(row)}
          onCancel={() => cancel(row)}
        />
      {/each}
    </div>
  {/if}
</section>

<style>
  .plugins {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 32px;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }
  .refresh {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 5px 12px;
    border-radius: var(--radius-lg);
    font-size: 12.5px;
  }
  .refresh:hover:not(:disabled) {
    background: var(--app-surface-hover);
    color: var(--color-text-primary);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .filters {
    display: flex;
    gap: 8px;
    margin: -6px 0 16px;
  }
  .filters button {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
  }
  .filters button.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .muted {
    color: var(--color-text-secondary);
    font-size: 13.5px;
  }
  .error {
    margin-bottom: 16px;
    padding: 10px 14px;
    border: 1px solid var(--color-state-danger);
    border-radius: var(--radius-lg);
    color: var(--color-state-danger);
    font-size: 13px;
  }
</style>
