<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
  import type {
    ProcessorProviderDetail,
    ProcessorProviderView,
    ProcessorSettings
  } from '../../../shared/processors'
  import type { PluginInstallQueueEntry } from '../../../shared/plugin-install-queue'
  import Badge from '../ui/Badge.svelte'
  import ProcessorProviderDialog from './ProcessorProviderDialog.svelte'
  import { capabilityName, legalStatus, needsAcknowledgement } from './presentation'

  let {
    provider,
    settings,
    onSettings,
    busy = false,
    queue = null,
    onUpdate,
    onRollback,
    onRemove,
    onCancel,
    headingLevel = 3
  }: {
    provider: ProcessorProviderView
    settings: ProcessorSettings
    onSettings: (settings: ProcessorSettings) => void
    busy?: boolean
    queue?: PluginInstallQueueEntry | null
    onUpdate?: () => void
    onRollback?: () => void
    onRemove?: () => void
    onCancel?: () => void
    // Plugins lists cards straight under its h1; Settings nests them under an h2.
    headingLevel?: 2 | 3
  } = $props()

  let detail = $state<ProcessorProviderDetail | null>(null)
  let disclosureCapability = $state<ProcessorAnalysisCapability | null>(null)
  let loadingDetail = $state(false)
  let saving = $state<ProcessorAnalysisCapability | null>(null)
  let error = $state<string | null>(null)

  async function loadDetail(): Promise<ProcessorProviderDetail | null> {
    loadingDetail = true
    const result = await window.iblis.processors.detail(provider.id)
    loadingDetail = false
    if (!result.ok) {
      error = result.error
      return null
    }
    if (!result.data) {
      error = 'This processor is no longer installed.'
      return null
    }
    detail = result.data
    return result.data
  }

  async function select(capability: ProcessorAnalysisCapability): Promise<void> {
    saving = capability
    error = null
    const result = await window.iblis.processors.setDefault(capability, provider.id)
    saving = null
    if (result.ok) onSettings(result.data)
    else error = result.error
  }

  async function requestSelection(capability: ProcessorAnalysisCapability): Promise<void> {
    if (needsAcknowledgement(provider) && !provider.acknowledged) {
      const current = await loadDetail()
      if (current) disclosureCapability = capability
      return
    }
    await select(capability)
  }

  async function confirmDisclosure(): Promise<void> {
    if (!disclosureCapability) return
    const result = await window.iblis.processors.acknowledge(provider.id)
    if (!result.ok) {
      error = result.error
      return
    }
    onSettings(result.data)
    const capability = disclosureCapability
    disclosureCapability = null
    detail = null
    await select(capability)
  }
</script>

<article class="card">
  <div class="head">
    <div>
      <svelte:element this={`h${String(headingLevel)}`} class="name">{provider.name}</svelte:element
      >
      <p>
        {provider.version} · {provider.runtime === 'built-in'
          ? 'Built into Iblis · No download'
          : 'Local native sidecar · Installed on demand'}
      </p>
    </div>
    <Badge tone={needsAcknowledgement(provider) ? 'warning' : 'success'} caps>
      {legalStatus(provider.legalStatus)}
    </Badge>
  </div>
  <div class="chips" aria-label="Provider capabilities">
    {#each provider.capabilities as capability (capability)}
      <Badge variant="outline">{capabilityName(capability)}</Badge>
    {/each}
    {#if provider.acknowledged}<Badge tone="success" variant="outline">Acknowledged</Badge>{/if}
  </div>
  <div class="actions">
    {#if queue}
      <span class="queue-state" role="status">
        {queue.phase === 'queued' ? 'Update queued for download' : 'Downloading update…'}
      </span>
      {#if onCancel}<button class="danger" onclick={onCancel}>Cancel</button>{/if}
    {/if}
    {#each provider.capabilities as capability (capability)}
      <button
        class:active={settings.defaults[capability] === provider.id}
        disabled={saving !== null}
        onclick={() => void requestSelection(capability)}
      >
        {settings.defaults[capability] === provider.id
          ? `${capabilityName(capability)} default`
          : `Select for ${capabilityName(capability)}`}
      </button>
    {/each}
    <button disabled={loadingDetail} onclick={() => void loadDetail()}>
      {loadingDetail ? 'Loading details…' : 'Details'}
    </button>
    {#if onUpdate}<button disabled={busy} onclick={onUpdate}>Update</button>{/if}
    {#if onRollback}<button disabled={busy} onclick={onRollback}>Roll back</button>{/if}
    {#if onRemove}<button class="danger" disabled={busy} onclick={onRemove}>Remove</button>{/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</article>

{#if detail && !disclosureCapability}
  <ProcessorProviderDialog {detail} onClose={() => (detail = null)} />
{/if}
{#if detail && disclosureCapability}
  <ProcessorProviderDialog
    {detail}
    disclosure
    onConfirm={() => void confirmDisclosure()}
    onClose={() => {
      disclosureCapability = null
      detail = null
    }}
  />
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .name,
  p {
    margin: 0;
  }
  .name {
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
  }
  p {
    margin-top: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
  .chips,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  button {
    min-height: 34px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-primary);
    padding: 6px var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  button:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  button.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  button.danger:hover:not(:disabled) {
    border-color: var(--color-state-danger);
    color: var(--color-state-danger);
  }
  button:disabled {
    cursor: wait;
    opacity: 0.55;
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .error {
    color: var(--color-danger);
  }
  .queue-state {
    align-self: center;
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
</style>
