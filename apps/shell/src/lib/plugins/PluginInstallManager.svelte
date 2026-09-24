<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { InstallProgress } from '../../../shared/contract'
  import type { PluginInstallQueueSnapshot } from '../../../shared/plugin-install-queue'
  import Badge from '../ui/Badge.svelte'

  let {
    snapshot,
    progress,
    names,
    onCancel
  }: {
    snapshot: PluginInstallQueueSnapshot
    progress: Record<string, InstallProgress>
    names: Record<string, string>
    onCancel: (id: string) => void
  } = $props()

  const label = (id: string): string => names[id] ?? id
  const status = (outcome: 'completed' | 'cancelled' | 'failed'): string =>
    outcome === 'completed' ? 'Completed' : outcome === 'cancelled' ? 'Cancelled' : 'Failed'
  const tone = (outcome: 'completed' | 'cancelled' | 'failed'): 'success' | 'neutral' | 'danger' =>
    outcome === 'completed' ? 'success' : outcome === 'cancelled' ? 'neutral' : 'danger'
  const bytes = (value: number): string => {
    if (value < 1024) return `${value} B`
    const units = ['KB', 'MB', 'GB']
    let amount = value / 1024
    let unit = 0
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024
      unit++
    }
    return `${amount.toFixed(amount < 10 ? 1 : 0)} ${units[unit]}`
  }
</script>

{#if snapshot.entries.length || snapshot.history.length}
  <section class="manager" aria-labelledby="downloads-title">
    <header>
      <div>
        <h2 id="downloads-title">Downloads</h2>
        <p>One transfer runs at a time so large packs do not compete for disk or bandwidth.</p>
      </div>
      {#if snapshot.entries.length}
        <Badge tone="accent" variant="outline">
          {snapshot.entries.length} active
        </Badge>
      {/if}
    </header>

    {#if snapshot.entries.length}
      <ol class="current" aria-label="Current downloads">
        {#each snapshot.entries as entry (entry.id)}
          {@const itemProgress = progress[entry.id]}
          <li>
            <div class="job">
              <strong>{label(entry.id)}</strong>
              <span>{entry.version}</span>
            </div>
            {#if entry.phase === 'queued'}
              <p>Queued{entry.position > 1 ? ` · ${entry.position - 1} ahead` : ''}</p>
            {:else if itemProgress?.overallTotal}
              <p>
                Downloading {itemProgress.percent}% · {bytes(itemProgress.overallReceived)} / {bytes(
                  itemProgress.overallTotal
                )}
              </p>
            {:else}
              <p>{itemProgress ? 'Downloading' : 'Preparing download'}</p>
            {/if}
            <button type="button" class="cancel" onclick={() => onCancel(entry.id)}>Cancel</button>
          </li>
        {/each}
      </ol>
    {/if}

    {#if snapshot.history.length}
      <details class="recent">
        <summary>Recent downloads</summary>
        <ul>
          {#each snapshot.history as entry (`${entry.id}-${entry.finishedAt}`)}
            <li>
              <div>
                <strong>{label(entry.id)}</strong>
                <span>{entry.version}</span>
              </div>
              <Badge tone={tone(entry.outcome)} variant="outline">{status(entry.outcome)}</Badge>
              {#if entry.message}<p role="alert">{entry.message}</p>{/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </section>
{/if}

<style>
  .manager {
    margin: 0 0 18px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  header,
  .current li,
  .recent li {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header {
    justify-content: space-between;
    padding: 13px 15px;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: 14px;
  }
  header p,
  .current p,
  .recent p,
  .job span,
  .recent span {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .current,
  .recent ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .current li,
  .recent li {
    flex-wrap: wrap;
    padding: 11px 15px;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .job,
  .recent li > div {
    display: flex;
    flex: 1 1 180px;
    flex-direction: column;
    min-width: 0;
  }
  .current p {
    flex: 2 1 180px;
  }
  button {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-primary);
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
  }
  .cancel:hover {
    border-color: var(--color-state-danger);
    color: var(--color-state-danger);
  }
  .recent summary {
    cursor: pointer;
    padding: 11px 15px;
    color: var(--color-text-secondary);
    font-size: 12px;
  }
  .recent li:last-child {
    border-bottom: 0;
  }
  .recent p {
    flex-basis: 100%;
    color: var(--color-state-danger);
    line-height: 1.45;
  }
</style>
