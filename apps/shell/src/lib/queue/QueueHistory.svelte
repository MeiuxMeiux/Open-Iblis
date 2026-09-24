<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { QueueEntry } from '../../../shared/generation-queue'
  import { library } from '../library.svelte'
  import { player } from '../player.svelte'
  import { queue } from '../queue.svelte'
  import Icon from '../ui/Icon.svelte'
  import ToggleBadge from '../ui/ToggleBadge.svelte'
  import { queueDescription, queueLabel, queueTitle, terminal } from './presentation'

  const history = $derived(queue.history)
  const refreshAttempts = new Map<string, number>()
  let refreshRetry = $state(0)
  const revealableGroups = $derived.by(() => {
    const groups = new Map<string, QueueEntry[]>()
    for (const entry of queue.entries) {
      const comparison = entry.comparison
      if (!comparison || comparison.revealed) continue
      const members = groups.get(comparison.groupId) ?? []
      members.push(entry)
      groups.set(comparison.groupId, members)
    }
    return [...groups.entries()]
      .filter(([, entries]) => entries.length === 2 && entries.every(terminal))
      .map(([groupId, entries]) => ({ groupId, prompt: entries[0]?.request.prompt ?? '' }))
  })

  $effect(() => {
    void refreshRetry
    const trackIds = history.flatMap((entry) =>
      entry.job?.result?.trackId ? [entry.job.result.trackId] : []
    )
    const unseen = trackIds.filter(
      (id) => !library.tracks.some((track) => track.id === id) && (refreshAttempts.get(id) ?? 0) < 2
    )
    if (unseen.length > 0) {
      for (const id of unseen) refreshAttempts.set(id, (refreshAttempts.get(id) ?? 0) + 1)
      void library.refresh().then(() => {
        if (
          unseen.some(
            (id) =>
              !library.tracks.some((track) => track.id === id) && (refreshAttempts.get(id) ?? 0) < 2
          )
        ) {
          setTimeout(() => refreshRetry++, 1500)
        }
      })
    }
  })

  function track(entry: QueueEntry) {
    const id = entry.job?.result?.trackId
    return id ? library.tracks.find((candidate) => candidate.id === id) : undefined
  }
</script>

<details class="queue-history">
  <summary>
    <span class="summary-label">
      <Icon name="history" size={13} />
      <span>{history.length} recent {history.length === 1 ? 'result' : 'results'}</span>
    </span>
  </summary>
  {#if revealableGroups.length > 0}
    <div class="comparison-reveals">
      {#each revealableGroups as group, index (group.groupId)}
        <button
          type="button"
          class="primary"
          disabled={!!queue.pendingAction}
          title={group.prompt}
          aria-label={`Reveal finished A/B ${index + 1}: ${group.prompt}`}
          onclick={() => void queue.reveal(group.groupId)}
        >
          <Icon name="eye" size={13} />
          <span>Reveal finished A/B</span>
        </button>
      {/each}
    </div>
  {/if}
  <ul>
    {#each history as entry (entry.id)}
      {@const result = track(entry)}
      <li>
        <span class:failed={entry.status === 'failed' || entry.status === 'interrupted'}>
          {queueTitle(entry, queueLabel(entry))}
        </span>
        <span title={entry.request.prompt}>
          {entry.request.prompt} · {queueDescription(entry)}
        </span>
        {#if result}
          <div class="comparison-actions">
            <button
              type="button"
              class="icon-action"
              onclick={() => {
                if (!library.isRemoving(result.id)) player.toggle(result)
              }}
              disabled={library.isRemoving(result.id)}
              title={player.activeId === result.id && player.playIntent ? 'Pause' : 'Play'}
              aria-label={`${player.activeId === result.id && player.playIntent ? 'Pause' : 'Play'} ${queueTitle(entry, result.name)}`}
            >
              <Icon
                name={player.activeId === result.id && player.playIntent ? 'pause' : 'play'}
                size={13}
              />
            </button>
            <ToggleBadge
              pressed={result.rating === 1}
              label={`Like ${queueTitle(entry, result.name)}`}
              title="Like"
              disabled={library.isRemoving(result.id)}
              onclick={() => void library.rate(result.id, 1)}
            >
              <Icon name="thumb-up" size={13} />
            </ToggleBadge>
            <ToggleBadge
              pressed={result.rating === -1}
              label={`Dislike ${queueTitle(entry, result.name)}`}
              title="Dislike"
              tone="neutral"
              disabled={library.isRemoving(result.id)}
              onclick={() => void library.rate(result.id, -1)}
            >
              <Icon name="thumb-down" size={13} />
            </ToggleBadge>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  <button type="button" disabled={!!queue.pendingAction} onclick={() => void queue.clear()}>
    <Icon name="trash" size={13} />
    <span>Clear finished</span>
  </button>
</details>
