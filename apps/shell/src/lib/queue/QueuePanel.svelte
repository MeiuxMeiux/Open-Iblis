<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { tick } from 'svelte'
  import type { GenerateRequest } from '@iblis/plugin-sdk'
  import type { QueueEntry } from '../../../shared/generation-queue'
  import Badge from '../ui/Badge.svelte'
  import Icon from '../ui/Icon.svelte'
  import { queue } from '../queue.svelte'
  import QueueEditForm from './QueueEditForm.svelte'
  import QueueHistory from './QueueHistory.svelte'
  import { queueDescription, queueLabel, queueTitle } from './presentation'
  import './queue-panel.css'
  import './comparison.css'

  let editingId = $state<string | null>(null)
  let panel = $state<HTMLElement | null>(null)

  const active = $derived(queue.active)
  const pending = $derived(queue.pending)

  $effect(() => {
    void queue.initialize()
  })

  function beginEdit(entry: QueueEntry): void {
    if (!queue.paused) return
    editingId = entry.id
  }

  function closeEdit(force = false, source: Element | null = document.activeElement): void {
    const id = editingId
    editingId = null
    if (!id) return
    void tick().then(() => {
      if (!force && document.activeElement !== document.body && document.activeElement !== source) {
        return
      }
      const actions = panel?.querySelectorAll<HTMLButtonElement>('button[data-edit-id]') ?? []
      for (const action of actions) {
        if (action.dataset.editId === id) {
          action.focus()
          break
        }
      }
    })
  }

  function move(entry: QueueEntry, offset: number): void {
    const index = queue.pending.findIndex((candidate) => candidate.id === entry.id)
    if (index < 0) return
    void queue.move(entry.id, index + offset)
  }
</script>

<section class="queue-panel" aria-labelledby="queue-title" bind:this={panel}>
  <header class="queue-header">
    <div>
      <h2 id="queue-title">Generation queue</h2>
      <p>One take runs at a time. Every pending take keeps its own settings.</p>
    </div>
    <Badge tone={queue.paused ? 'accent' : 'neutral'} variant="outline">
      {queue.paused ? 'Paused' : `${queue.pendingCount} pending`}
    </Badge>
  </header>

  {#if !queue.loaded}
    <p class="queue-message" role="status">Loading queue…</p>
  {:else}
    {#if queue.error}
      <p class="queue-message error" role="alert">{queue.error}</p>
    {/if}

    {#if queue.paused && queue.pauseReason}
      <p class="queue-message warning" role="status">{queue.pauseReason}</p>
    {/if}

    <div class="queue-controls">
      {#if queue.paused}
        <button
          type="button"
          class="primary"
          disabled={!!queue.pendingAction || editingId !== null}
          title={editingId ? 'Save or cancel the queued edit before resuming' : undefined}
          onclick={() => void queue.resume()}
        >
          <Icon name="play" size={13} />
          <span>Resume</span>
        </button>
      {:else if active !== null || queue.pendingCount > 0}
        <button type="button" disabled={!!queue.pendingAction} onclick={() => void queue.pause()}>
          <Icon name="pause" size={13} />
          <span>Pause after current</span>
        </button>
      {/if}
      {#if active}
        <button
          type="button"
          class="danger"
          disabled={!!queue.pendingAction}
          onclick={() => void queue.cancel()}
        >
          <Icon name="stop" size={13} />
          <span>Stop current</span>
        </button>
      {/if}
    </div>

    {#if active}
      <article class="queue-entry active-entry">
        <div class="entry-topline">
          <strong>{queueTitle(active, queueLabel(active))}</strong>
          <span>{Math.round((active.job?.progress ?? 0) * 100)}%</span>
        </div>
        <p class="entry-prompt">{active.request.prompt}</p>
        <p class="entry-meta">{queueDescription(active)}</p>
        <progress aria-label="Current generation progress" max="1" value={active.job?.progress ?? 0}
        ></progress>
      </article>
    {/if}

    {#if pending.length > 0}
      <ol class="queue-list" aria-label="Pending generations">
        {#each pending as entry, index (entry.id)}
          <li class="queue-entry">
            {#if editingId === entry.id}
              <QueueEditForm
                {entry}
                busy={!!queue.pendingAction}
                onsave={(request: GenerateRequest) => queue.edit(entry.id, request)}
                onclose={closeEdit}
              />
            {:else}
              <div class="entry-topline">
                <strong>{queueTitle(entry, `Next ${index + 1}`)}</strong>
                <span>{queueDescription(entry)}</span>
              </div>
              <p class="entry-prompt">{entry.request.prompt}</p>
              {#if entry.comparison}
                {@const comparison = entry.comparison}
                <p class="comparison-lock">Controlled pair: individual queue actions are locked.</p>
                {#if pending.find((candidate) => candidate.comparison?.groupId === entry.comparison?.groupId)?.id === entry.id}
                  <div class="entry-actions">
                    <button
                      type="button"
                      class="danger"
                      disabled={!!queue.pendingAction ||
                        active?.comparison?.groupId === entry.comparison.groupId}
                      onclick={() => void queue.discardComparison(comparison.groupId)}
                    >
                      <Icon name="trash" size={13} />
                      <span>Abandon unfinished</span>
                    </button>
                  </div>
                {/if}
              {:else}
                <div class="entry-actions">
                  <button
                    type="button"
                    class="icon-action"
                    disabled={index === 0 || !!queue.pendingAction}
                    aria-label={`Move queued take ${index + 1} earlier`}
                    title="Move earlier"
                    onclick={() => move(entry, -1)}
                  >
                    <Icon name="chevron-up" size={14} />
                  </button>
                  <button
                    type="button"
                    class="icon-action"
                    disabled={index === pending.length - 1 || !!queue.pendingAction}
                    aria-label={`Move queued take ${index + 1} later`}
                    title="Move later"
                    onclick={() => move(entry, 1)}
                  >
                    <Icon name="chevron-down" size={14} />
                  </button>
                  <button
                    type="button"
                    class="icon-action"
                    disabled={!queue.paused || !!queue.pendingAction}
                    aria-label={`Edit queued take ${index + 1}`}
                    title={queue.paused ? 'Edit' : 'Pause queue to edit'}
                    data-edit-id={entry.id}
                    onclick={() => beginEdit(entry)}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    type="button"
                    class="icon-action"
                    disabled={!!queue.pendingAction}
                    aria-label={`Duplicate queued take ${index + 1}`}
                    title="Duplicate"
                    onclick={() => void queue.duplicate(entry.id)}
                  >
                    <Icon name="copy" size={13} />
                  </button>
                  <button
                    type="button"
                    class="danger"
                    disabled={!!queue.pendingAction}
                    aria-label={`Remove queued take ${index + 1}`}
                    title="Remove"
                    onclick={() => void queue.remove(entry.id)}
                  >
                    <Icon name="trash" size={13} />
                    <span>Remove</span>
                  </button>
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ol>
    {:else if !active}
      <p class="queue-empty">No generations queued.</p>
    {/if}

    {#if queue.history.length > 0}
      <QueueHistory />
    {/if}
  {/if}
</section>
