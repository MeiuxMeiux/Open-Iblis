<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { ProcessorProviderDetail } from '../../../shared/processors'
  import Icon from '../ui/Icon.svelte'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'

  let {
    detail,
    disclosure = false,
    onConfirm,
    onClose
  }: {
    detail: ProcessorProviderDetail
    disclosure?: boolean
    onConfirm?: () => void
    onClose: () => void
  } = $props()

  let acknowledged = $state(false)
  let panel = $state<HTMLElement>()
  const evaluation = $derived(detail.evaluation)

  onMount(() => void tick().then(() => panel?.focus()))

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose()
  }
</script>

<svelte:window onkeydown={keydown} />
<button class="scrim" aria-label="Close provider details" onclick={onClose}></button>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="processor-provider-title"
  tabindex="-1"
  bind:this={panel}
>
  <header>
    <div>
      <p class="eyebrow">
        {disclosure ? 'Private evaluation disclosure' : 'Audio provider details'}
      </p>
      <h2 id="processor-provider-title">{detail.name}</h2>
    </div>
    <button class="close" type="button" aria-label="Close provider details" onclick={onClose}>
      <Icon name="close" size={15} />
    </button>
  </header>

  <dl>
    <div>
      <dt>Version</dt>
      <dd>{detail.version}</dd>
    </div>
    <div>
      <dt>Runtime</dt>
      <dd>
        {detail.runtime === 'built-in'
          ? 'Built into Iblis (worker thread)'
          : 'Local native sidecar'}
      </dd>
    </div>
    <div>
      <dt>Capabilities</dt>
      <dd>
        {detail.capabilities
          .map((capability) => (capability === 'bpm-detect' ? 'BPM' : 'Key'))
          .join(', ')}
      </dd>
    </div>
    <div>
      <dt>Author</dt>
      <dd>{detail.author}</dd>
    </div>
    <div>
      <dt>Code terms</dt>
      <dd>{evaluation?.codeLicense ?? detail.codeLicense}</dd>
    </div>
    {#if evaluation?.modelLicense}<div>
        <dt>Model terms</dt>
        <dd>{evaluation.modelLicense}</dd>
      </div>{/if}
    {#if evaluation}
      <div>
        <dt>Distribution</dt>
        <dd>{evaluation.distribution}</dd>
      </div>
      <div>
        <dt>Upstream revision</dt>
        <dd>{evaluation.upstreamRevision}</dd>
      </div>
      <div>
        <dt>Notice record</dt>
        <dd>{evaluation.noticePath}</dd>
      </div>
      <div>
        <dt>Dependencies</dt>
        <dd>{evaluation.dependencyLicenses.join(', ') || 'None declared'}</dd>
      </div>
      {#if evaluation.releaseBlocker}<div>
          <dt>Promotion blocker</dt>
          <dd>{evaluation.releaseBlocker}</dd>
        </div>{/if}
    {/if}
  </dl>

  {#if evaluation}
    <p class="notice">{evaluation.acknowledgement}</p>
    <a href={evaluation.termsUrl} target="_blank" rel="noreferrer">Open provider terms</a>
  {:else}
    <p class="notice">This installed provider has no recorded evaluation disclosure.</p>
  {/if}

  {#if disclosure && evaluation}
    <ToggleSwitch
      bind:checked={acknowledged}
      label="I understand this provider is restricted to private evaluation"
      description="Iblis records this acknowledgement for this exact provider version and upstream revision."
    />
  {/if}
  <footer>
    <button type="button" onclick={onClose}>Close</button>
    {#if disclosure && evaluation}
      <button class="primary" type="button" disabled={!acknowledged} onclick={onConfirm}
        >Enable for private evaluation</button
      >
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
    width: min(560px, calc(100vw - var(--space-6)));
    max-height: min(720px, calc(100vh - var(--space-6)));
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
    gap: var(--space-3);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  .eyebrow {
    margin-bottom: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .close {
    display: grid;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
  }
  dl {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-4) 0;
  }
  dl div {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr);
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  dt,
  dd,
  a,
  .notice {
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-secondary);
  }
  .notice {
    margin: var(--space-3) 0;
    color: var(--color-text-secondary);
  }
  a {
    color: var(--color-accent);
  }
  footer {
    justify-content: flex-end;
    margin-top: var(--space-4);
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
  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (max-width: 480px) {
    dl div {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }
  }
</style>
