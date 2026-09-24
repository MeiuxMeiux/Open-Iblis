<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    CloudDefaultTask,
    CloudProviderId,
    CloudProvidersSnapshot,
    CloudTask
  } from '../../../shared/cloud-providers'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'
  import CloudModelRegistry from './CloudModelRegistry.svelte'

  let snapshot = $state<CloudProvidersSnapshot | null>(null)
  let key = $state<Record<CloudProviderId, string>>({ openrouter: '', imagerouter: '' })
  let busy = $state<string | null>(null)
  let error = $state<string | null>(null)

  onMount(() => void load())

  async function run(
    action: string,
    call: () => Promise<Awaited<ReturnType<typeof window.iblis.cloudProviders.snapshot>>>
  ) {
    busy = action
    error = null
    const result = await call()
    if (result.ok) snapshot = result.data
    else error = result.error
    busy = null
  }

  async function load(): Promise<void> {
    await run('load', () => window.iblis.cloudProviders.snapshot())
  }

  function tasks(provider: CloudProviderId): CloudTask[] {
    return provider === 'openrouter' ? ['song-ideas', 'lyrics-assistance'] : ['cover-generation']
  }
</script>

<section class="cloud" aria-labelledby="cloud-heading">
  <div>
    <h2 id="cloud-heading">Cloud providers</h2>
    <p class="hint">
      Optional user-owned keys for future, deliberate assistance tools. Nothing is sent while a
      provider is disabled; refreshing models and testing a key never generates content or spends
      credits.
    </p>
  </div>

  {#if !snapshot}
    <p class="state" role="status">Checking cloud-provider settings…</p>
  {:else}
    {#if !snapshot.secureStorageAvailable}
      <p class="error" role="alert">
        Cloud keys are unavailable because this system’s secure key storage is not available. Iblis
        will not save a plaintext fallback.
      </p>
    {/if}

    {#each snapshot.providers as provider (provider.id)}
      <article class="card">
        <header>
          <div>
            <h3>{provider.name}</h3>
            <p class="state">{provider.status.replaceAll('-', ' ')}</p>
          </div>
          <ToggleSwitch
            compact
            checked={provider.enabled}
            disabled={busy !== null || !snapshot.secureStorageAvailable}
            label="Enable provider"
            onToggle={(enabled: boolean) =>
              run(`enabled-${provider.id}`, () =>
                window.iblis.cloudProviders.setEnabled(provider.id, enabled)
              )}
          />
        </header>

        <p class="disclosure">
          {#if provider.id === 'openrouter'}
            OpenRouter may route a request across model providers. Future requests start with
            provider fallback disabled and a privacy-preserving routing choice when available; the
            selected model and routing policy are shown before submission.
          {:else}
            ImageRouter logs prompts and forwards prompts, images, and parameters to an external
            provider. Its downstream retention may differ. Future cover requests use ephemeral image
            bytes by default, but the underlying provider may retain an image.
          {/if}
        </p>

        {#if !provider.consented}
          <button
            type="button"
            disabled={busy !== null}
            onclick={() =>
              run(`consent-${provider.id}`, () =>
                window.iblis.cloudProviders.acknowledgeConsent(provider.id)
              )}
          >
            I understand this disclosure
          </button>
        {/if}

        <div class="key-row">
          <label>
            <span>Add or replace key</span>
            <input
              bind:value={key[provider.id]}
              type="password"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <button
            type="button"
            disabled={!key[provider.id] || busy !== null || !snapshot.secureStorageAvailable}
            onclick={() =>
              run(`key-${provider.id}`, async () => {
                const result = await window.iblis.cloudProviders.saveKey(
                  provider.id,
                  key[provider.id]
                )
                if (result.ok) key[provider.id] = ''
                return result
              })}>Save key</button
          >
          <button
            type="button"
            disabled={!provider.hasKey || busy !== null}
            onclick={() =>
              run(`test-${provider.id}`, () => window.iblis.cloudProviders.test(provider.id))}
            >Test connection</button
          >
          <button
            type="button"
            disabled={!provider.hasKey || busy !== null}
            onclick={() =>
              run(`remove-${provider.id}`, () =>
                window.iblis.cloudProviders.removeKey(provider.id)
              )}>Remove key</button
          >
        </div>

        <div class="tasks">
          {#each tasks(provider.id) as task (task)}
            <ToggleSwitch
              compact
              checked={provider.tasks[task]}
              disabled={busy !== null || !provider.enabled}
              label={task.replaceAll('-', ' ')}
              onToggle={(enabled: boolean) =>
                run(`task-${provider.id}-${task}`, () =>
                  window.iblis.cloudProviders.setTask(provider.id, task, enabled)
                )}
            />
          {/each}
        </div>

        <div class="refresh">
          <span
            >{provider.lastUpdatedAt
              ? `Models updated ${new Date(provider.lastUpdatedAt).toLocaleString()}`
              : 'No cached models'}</span
          >
          <button
            type="button"
            disabled={busy !== null}
            onclick={() =>
              run(`refresh-${provider.id}`, () =>
                window.iblis.cloudProviders.refreshModels(provider.id)
              )}>Refresh models</button
          >
        </div>
      </article>
    {/each}

    <CloudModelRegistry
      {snapshot}
      busy={busy !== null}
      onSetDefault={(task: CloudDefaultTask, modelId?: string) =>
        run(`default-${task}`, () => window.iblis.cloudProviders.setDefault(task, modelId))}
    />
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .cloud,
  .card,
  .key-row,
  .tasks,
  .refresh {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .cloud {
    padding: 16px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  h2,
  h3 {
    margin: 0;
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-secondary);
  }
  h3 {
    font-size: 14px;
  }
  .hint,
  .state,
  .disclosure,
  .error {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--color-text-secondary);
  }
  .card {
    padding: 14px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--app-bg);
  }
  .card header,
  .refresh {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
  }
  .key-row {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) repeat(3, max-content);
    align-items: end;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
  }
  input,
  button {
    min-height: 34px;
    padding: 7px 9px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--app-surface);
    color: var(--color-text-primary);
    font: inherit;
  }
  button:disabled,
  input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .error {
    color: var(--color-danger);
  }
  @media (max-width: 620px) {
    .key-row {
      grid-template-columns: 1fr;
    }
    .card header,
    .refresh {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
