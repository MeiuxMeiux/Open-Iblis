<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { AdapterImportDetails } from '../../../shared/adapters'
  import Icon from '../ui/Icon.svelte'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'

  let {
    details,
    actionLabel,
    onConfirm,
    onClose
  }: {
    details: AdapterImportDetails
    actionLabel: string
    onConfirm: () => void
    onClose: () => void
  } = $props()

  let acknowledged = $state(false)
  let panel = $state<HTMLElement>()

  onMount(() => {
    void tick().then(() => panel?.focus())
  })

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose()
  }

  // Publisher-supplied text, or a placeholder when absent or blank.
  function supplied(value: string | null | undefined): string {
    const text = value?.trim()
    if (!text) return 'Not supplied'
    return text
  }
</script>

<svelte:window onkeydown={keydown} />
<button class="scrim" aria-label="Close disclosure" onclick={onClose}></button>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="style-disclosure-title"
  tabindex="-1"
  bind:this={panel}
>
  <header>
    <div>
      <p class="eyebrow">Style disclosure</p>
      <h2 id="style-disclosure-title">Review before continuing</h2>
    </div>
    <button class="close" type="button" aria-label="Close disclosure" onclick={onClose}>
      <Icon name="close" size={15} />
    </button>
  </header>

  <p class="lead">
    {details.displayName} is a community or local style. It is not certified or enabled for generation.
  </p>

  <dl>
    <div>
      <dt>Source</dt>
      <dd>{supplied(details.sourceUrl)}</dd>
    </div>
    <div>
      <dt>Publisher terms</dt>
      <dd>{supplied(details.claimedLicense)}</dd>
    </div>
    <div>
      <dt>Engine claim</dt>
      <dd>{supplied(details.claimedBaseModel)}</dd>
    </div>
    {#if details.terms?.trim()}
      <div>
        <dt>Additional terms</dt>
        <dd>{details.terms.trim()}</dd>
      </div>
    {/if}
  </dl>

  <p class="notice">
    Local availability does not grant commercial, copyright, publicity, or training-data rights.
    Only add material you are allowed to use.
  </p>
  <ToggleSwitch
    bind:checked={acknowledged}
    label="I understand the limits"
    description="Iblis will keep this style in the local library only until compatibility is proven."
  />
  <footer>
    <button type="button" onclick={onClose}>Cancel</button>
    <button class="primary" type="button" disabled={!acknowledged} onclick={onConfirm}>
      {actionLabel}
    </button>
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
    width: min(520px, calc(100vw - var(--space-6)));
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
  .lead {
    margin-top: var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
  dl {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-4) 0;
  }
  dl div {
    display: grid;
    grid-template-columns: 116px minmax(0, 1fr);
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  dt,
  dd {
    margin: 0;
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    overflow-wrap: anywhere;
    color: var(--color-text-secondary);
  }
  .notice {
    margin-bottom: var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.5;
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
  button.primary:hover:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-text-inverse);
    filter: brightness(1.12);
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
    .dialog {
      padding: var(--space-4);
    }
    dl div {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }
  }
</style>
