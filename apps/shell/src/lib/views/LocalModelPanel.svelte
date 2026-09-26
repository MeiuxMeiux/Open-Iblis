<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { IpcResult } from '../../../shared/contract'
  import { LOCAL_HOSTS, type LocalHost, type LocalModelView } from '../../../shared/text-assist'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'

  // Settings for the Local model text provider: an OpenAI-compatible server
  // already running on this computer. Main accepts only loopback addresses.
  let view = $state<LocalModelView | null>(null)
  let host = $state<LocalHost>('127.0.0.1')
  let port = $state(11434)
  let busy = $state(false)
  let error = $state<string | null>(null)

  onMount(() => void run(() => window.iblis.localModel.snapshot()))

  async function run(call: () => Promise<IpcResult<LocalModelView>>): Promise<void> {
    busy = true
    error = null
    const result = await call()
    if (result.ok) {
      view = result.data
      host = result.data.host
      port = result.data.port
    } else error = result.error
    busy = false
  }

  const changed = $derived(!!view && (view.host !== host || view.port !== port))

  async function test(): Promise<void> {
    await run(() => window.iblis.localModel.test())
    // A failed test is recorded on the view; reload so its message shows.
    if (error) {
      const failed = error
      await run(() => window.iblis.localModel.snapshot())
      error = failed
    }
  }
</script>

<section class="local" aria-labelledby="local-heading">
  <div>
    <h2 id="local-heading">Local model</h2>
    <p class="hint">
      Use a model server already running on this computer, such as Ollama, LM Studio, or llama.cpp
      llama-server, for song ideas and lyrics in Create. Iblis connects only to the loopback address
      below, never to another machine, and nothing is sent until you use Test connection or a Create
      helper.
    </p>
  </div>

  {#if !view}
    <p class="hint" role="status">Checking local model settings...</p>
  {:else}
    <ToggleSwitch
      checked={view.enabled}
      disabled={busy}
      label="Use a local model"
      description="Off until you turn it on. No key and no cost."
      onToggle={(enabled: boolean) => run(() => window.iblis.localModel.setEnabled(enabled))}
    />

    <div class="address">
      <label>
        <span>Address</span>
        <select bind:value={host} disabled={busy}>
          {#each LOCAL_HOSTS as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Port</span>
        <input type="number" min="1" max="65535" step="1" bind:value={port} disabled={busy} />
      </label>
      <button
        type="button"
        disabled={busy || !changed}
        onclick={() => run(() => window.iblis.localModel.configure(host, port))}
      >
        Save address
      </button>
      <button type="button" disabled={busy || changed || !view.enabled} onclick={() => void test()}>
        Test connection
      </button>
    </div>
    <p class="hint">Common ports: Ollama 11434, LM Studio 1234, llama-server 8080.</p>

    <p class="hint" role="status">
      {#if view.models.length > 0}
        {view.models.length} model{view.models.length === 1 ? '' : 's'} available: {view.models
          .slice(0, 8)
          .join(', ')}{view.models.length > 8 ? ', ...' : ''}
      {:else if view.lastCheckedAt}
        No models listed yet.
      {:else}
        Not tested yet.
      {/if}
    </p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .local {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-secondary);
  }
  .hint,
  .error {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--color-text-secondary);
  }
  .error {
    color: var(--color-danger);
  }
  .address {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) 110px repeat(2, max-content);
    gap: 10px;
    align-items: end;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
  }
  input,
  select,
  button {
    min-height: 34px;
    padding: 7px 9px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--app-bg);
    color: var(--color-text-primary);
    font: inherit;
  }
  button:disabled,
  input:disabled,
  select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  input:focus-visible,
  select:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (max-width: 620px) {
    .address {
      grid-template-columns: 1fr;
    }
  }
</style>
