<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import type { GenerateRequest } from '@iblis/plugin-sdk'
  import type { QueueEntry } from '../../../shared/generation-queue'

  let {
    entry,
    busy,
    onsave,
    onclose
  }: {
    entry: QueueEntry
    busy: boolean
    onsave: (request: GenerateRequest) => Promise<boolean>
    onclose: (force?: boolean, source?: Element | null) => void
  } = $props()

  const initialRequest = untrack(() => entry.request)
  let prompt = $state(initialRequest.prompt)
  let duration = $state(initialRequest.durationSec)
  let seed = $state(initialRequest.seed === undefined ? '' : String(initialRequest.seed))
  let error = $state<string | null>(null)
  let errorField = $state<'prompt' | 'duration' | 'seed' | null>(null)
  let promptInput = $state<HTMLTextAreaElement | null>(null)
  let durationInput = $state<HTMLInputElement | null>(null)
  let seedInput = $state<HTMLInputElement | null>(null)

  onMount(() => {
    void tick().then(() => promptInput?.focus())
  })

  async function save(): Promise<void> {
    const cleanPrompt = prompt.trim()
    const cleanSeed = seed.trim() === '' ? undefined : Number(seed.trim())
    if (!cleanPrompt) {
      error = 'Enter a prompt.'
      errorField = 'prompt'
      await tick()
      promptInput?.focus()
      return
    }
    if (!Number.isFinite(duration) || duration < 4 || duration > 240) {
      error = 'Length must be between 4 and 240 seconds.'
      errorField = 'duration'
      await tick()
      durationInput?.focus()
      return
    }
    if (
      cleanSeed !== undefined &&
      (!Number.isInteger(cleanSeed) || cleanSeed < 0 || cleanSeed > 0xffff_ffff)
    ) {
      error = 'Seed must be a whole number from 0 to 4294967295.'
      errorField = 'seed'
      await tick()
      seedInput?.focus()
      return
    }

    error = null
    errorField = null
    const request: GenerateRequest = {
      ...entry.request,
      prompt: cleanPrompt,
      durationSec: duration,
      seed: cleanSeed
    }
    const source = document.activeElement
    if (await onsave(request)) {
      onclose(false, source)
      return
    }
    await tick()
    if (
      source instanceof HTMLElement &&
      source.isConnected &&
      (document.activeElement === document.body || document.activeElement === source)
    ) {
      source.focus()
    }
  }
</script>

<div class="queue-edit">
  <label>
    <span>Prompt</span>
    <textarea
      bind:this={promptInput}
      bind:value={prompt}
      rows="3"
      readonly={busy}
      aria-invalid={errorField === 'prompt'}
      aria-describedby={errorField === 'prompt' ? `queue-edit-error-${entry.id}` : undefined}
    ></textarea>
  </label>
  <div class="edit-row">
    <label>
      <span>Length</span>
      <input
        type="number"
        bind:this={durationInput}
        min="4"
        max="240"
        step="any"
        bind:value={duration}
        readonly={busy}
        aria-invalid={errorField === 'duration'}
        aria-describedby={errorField === 'duration' ? `queue-edit-error-${entry.id}` : undefined}
      />
    </label>
    <label>
      <span>Seed</span>
      <input
        bind:this={seedInput}
        bind:value={seed}
        inputmode="numeric"
        placeholder="random"
        readonly={busy}
        aria-invalid={errorField === 'seed'}
        aria-describedby={errorField === 'seed' ? `queue-edit-error-${entry.id}` : undefined}
      />
    </label>
  </div>
  {#if error}
    <p id={`queue-edit-error-${entry.id}`} class="edit-error" role="alert">{error}</p>
  {/if}
  <div class="entry-actions">
    <button type="button" disabled={busy} onclick={() => onclose(true)}>Cancel</button>
    <button type="button" class="primary" disabled={busy} onclick={() => void save()}>Save</button>
  </div>
</div>
