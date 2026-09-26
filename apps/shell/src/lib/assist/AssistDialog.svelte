<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { AssistTask } from '../../../shared/text-assist'
  import { estimateUsd } from '../../../shared/assist-prompts'
  import Icon from '../ui/Icon.svelte'
  import AssistBrief from './AssistBrief.svelte'
  import { AssistFlow } from './assist-flow.svelte'
  import { merged, priceLabel } from './assist-text'
  import { LOCAL_DISCLOSURE, OPENROUTER_DISCLOSURE, OPENROUTER_ROUTING } from './disclosures'

  // Brief, confirm, run, preview. The result is only an editable preview until
  // the user presses Insert, Replace, or Append.
  let {
    task,
    current,
    oninsert,
    onclose
  }: {
    task: AssistTask
    current: string
    oninsert: (text: string) => void
    onclose: () => void
  } = $props()

  // The dialog is mounted per open, so its task never changes while it lives.
  // svelte-ignore state_referenced_locally
  const flow = new AssistFlow(task)
  const title = $derived(task === 'lyrics-assistance' ? 'Write lyrics' : 'Song idea')
  let panel = $state<HTMLElement>()

  onMount(() => {
    void flow.load()
    void tick().then(() => panel?.focus())
  })

  const isLocal = $derived(flow.providerId === 'local')
  const estimate = $derived(
    flow.model && flow.request && !isLocal ? estimateUsd(flow.model, flow.request) : undefined
  )

  function close(): void {
    void flow.cancel()
    onclose()
  }

  function insert(mode: 'replace' | 'append'): void {
    oninsert(merged(task, current, flow.preview.trim(), mode))
    onclose()
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close()
  }
</script>

<svelte:window onkeydown={keydown} />
<button class="scrim" aria-label="Close {title}" onclick={close}></button>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="assist-title"
  tabindex="-1"
  bind:this={panel}
>
  <header>
    <h2 id="assist-title">{title}</h2>
    <button class="close" type="button" aria-label="Close {title}" onclick={close}>
      <Icon name="close" size={15} />
    </button>
  </header>

  {#if flow.step === 'brief'}
    <AssistBrief {flow} />
  {:else if flow.step === 'preview'}
    <label class="preview">
      <span>Preview (edit freely; nothing changes in Create until you insert)</span>
      <textarea bind:value={flow.preview} rows={task === 'lyrics-assistance' ? 14 : 3}></textarea>
    </label>
    {#if flow.truncated}
      <p class="note">The reply was long and has been shortened.</p>
    {/if}
    <p class="note">From {flow.provider?.name}, {flow.model?.name ?? flow.modelId}.</p>
  {:else}
    <dl>
      <div>
        <dt>Provider</dt>
        <dd>{flow.provider?.name}</dd>
      </div>
      <div>
        <dt>Model</dt>
        <dd>{flow.model?.name ?? flow.modelId}</dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>{isLocal ? 'None; runs on this computer' : priceLabel(flow.model, estimate)}</dd>
      </div>
      {#if !isLocal}<div>
          <dt>Routing</dt>
          <dd>{OPENROUTER_ROUTING}</dd>
        </div>{/if}
    </dl>
    <p class="note">{isLocal ? LOCAL_DISCLOSURE : OPENROUTER_DISCLOSURE}</p>
    {#if flow.step === 'running'}
      <p class="note" role="status">Writing... this can take a minute on a local model.</p>
    {/if}
  {/if}

  {#if flow.error}<p class="error" role="alert">{flow.error}</p>{/if}

  <footer>
    {#if flow.step === 'brief'}
      <button type="button" onclick={close}>Cancel</button>
      <button class="primary" type="button" disabled={!flow.ready} onclick={() => flow.review()}>
        Review
      </button>
    {:else if flow.step === 'confirm'}
      <button type="button" onclick={() => flow.back()}>Back</button>
      <button class="primary" type="button" onclick={() => void flow.send()}>
        {isLocal ? 'Write with local model' : 'Send to OpenRouter'}
      </button>
    {:else if flow.step === 'running'}
      <button type="button" onclick={() => void flow.cancel()}>Cancel request</button>
    {:else}
      <button type="button" onclick={close}>Discard</button>
      <button type="button" onclick={() => (flow.step = 'confirm')}>Try again</button>
      {#if current.trim()}
        <button type="button" disabled={!flow.preview.trim()} onclick={() => insert('append')}>
          Append
        </button>
        <button
          class="primary"
          type="button"
          disabled={!flow.preview.trim()}
          onclick={() => insert('replace')}
        >
          Replace
        </button>
      {:else}
        <button
          class="primary"
          type="button"
          disabled={!flow.preview.trim()}
          onclick={() => insert('replace')}
        >
          Insert
        </button>
      {/if}
    {/if}
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    z-index: 40;
    inset: 0;
    border: 0;
    background: color-mix(in srgb, var(--color-bg-base) 88%, transparent);
  }
  .dialog {
    position: fixed;
    z-index: 41;
    top: 50%;
    left: 50%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(560px, calc(100vw - var(--space-6)));
    max-height: min(760px, calc(100vh - var(--space-6)));
    overflow: auto;
    padding: var(--space-5);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    box-shadow: var(--shadow-lg);
    transform: translate(-50%, -50%);
  }
  .dialog:focus {
    outline: none;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  footer {
    justify-content: flex-end;
    margin-top: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
  }
  .close {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    padding: 0;
  }
  dl {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }
  dl div {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr);
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  dt,
  dd,
  .note,
  .error,
  .preview span {
    margin: 0;
    font-size: var(--font-size-xs);
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--color-danger);
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  textarea {
    padding: 9px 11px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--app-surface);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    resize: vertical;
  }
  button {
    min-height: 34px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
    padding: 6px var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  button:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  button.primary {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    font-weight: var(--font-weight-semibold);
  }
  button.primary:hover:not(:disabled) {
    background: var(--color-accent);
    filter: brightness(1.12);
  }
  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
  button:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
