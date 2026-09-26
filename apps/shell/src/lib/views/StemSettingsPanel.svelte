<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { StemBackend } from '@iblis/plugin-sdk'
  import type { StemsSnapshot } from '../../../shared/stems'
  import { STEM_LABELS } from '../../../shared/stems'
  import { nav } from '../navigation.svelte'
  import Icon from '../ui/Icon.svelte'
  import { STEM_ICONS, stemColorVar } from '../stems/presentation'

  let snapshot = $state<StemsSnapshot | null>(null)
  let error = $state<string | null>(null)

  const BACKENDS: { id: StemBackend; title: string; detail: string }[] = [
    { id: 'auto', title: 'Automatic', detail: 'GPU when available, CPU otherwise' },
    { id: 'gpu', title: 'GPU only', detail: 'Fails instead of falling back' },
    { id: 'cpu', title: 'CPU only', detail: 'Slow, but leaves the GPU free' }
  ]

  onMount(() => void refresh())

  async function refresh(): Promise<void> {
    const result = await window.iblis.stems.snapshot()
    if (result.ok) snapshot = result.data
    else error = result.error
  }

  async function update(patch: { defaultProvider?: string; backend?: StemBackend }): Promise<void> {
    const result = await window.iblis.stems.setSettings(patch)
    if (result.ok) snapshot = result.data
    else error = result.error
  }
</script>

<section class="stems-settings" aria-labelledby="stems-heading">
  <h2 id="stems-heading"><Icon name="stems" size={18} />Stems</h2>
  <p class="hint">
    Split a finished track into vocals, drums, bass, and other from its Library detail. Separation
    runs on this computer; the original track is never modified, and each stem set can be deleted on
    its own.
  </p>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if snapshot}
    <h3>Separator</h3>
    {#if snapshot.providers.length === 0}
      <div class="none">
        <p>No stem separator is installed yet.</p>
        <button onclick={() => nav.go('plugins')}
          ><Icon name="plugin" size={14} />Open Plugins</button
        >
      </div>
    {:else}
      <div class="providers" role="radiogroup" aria-label="Default stem separator">
        {#each snapshot.providers as p (p.id)}
          {@const selected =
            snapshot.settings.defaultProvider === p.id ||
            (!snapshot.settings.defaultProvider && p.model === 'htdemucs')}
          <button
            class="provider"
            class:selected
            role="radio"
            aria-checked={selected}
            disabled={!p.ready}
            onclick={() => update({ defaultProvider: p.id })}
          >
            <span class="head">
              <strong>{p.label}</strong>
              <span class="ver">{p.name} {p.version}</span>
            </span>
            <span class="desc">{p.description}</span>
            <span class="roles">
              {#each p.stems as role (role)}
                <span class="role" style:--lane={stemColorVar(role)}>
                  <Icon name={STEM_ICONS[role]} size={11} />{STEM_LABELS[role]}
                </span>
              {/each}
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <h3>Compute</h3>
    <div class="backends" role="radiogroup" aria-label="Where separation runs">
      {#each BACKENDS as b (b.id)}
        <button
          class="backend"
          class:selected={snapshot.settings.backend === b.id}
          role="radio"
          aria-checked={snapshot.settings.backend === b.id}
          onclick={() => update({ backend: b.id })}
        >
          <strong>{b.title}</strong>
          <span>{b.detail}</span>
        </button>
      {/each}
    </div>
    <p class="hint">
      Separation waits while a generation or a training run is using the GPU, and never starts on
      its own.
    </p>
  {:else if !error}
    <p class="hint" role="status">Checking installed separators...</p>
  {/if}
</section>

<style>
  .stems-settings {
    display: grid;
    gap: var(--space-3);
    max-width: 760px;
  }
  h2 {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }
  h2 :global(svg) {
    color: var(--color-accent);
  }
  h3 {
    margin: var(--space-3) 0 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .hint,
  .error {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  .error {
    color: var(--color-state-danger);
  }
  .providers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .provider,
  .backend {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    text-align: left;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    font: inherit;
    cursor: pointer;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .provider:hover,
  .backend:hover {
    border-color: var(--color-accent);
  }
  .provider.selected,
  .backend.selected {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent) inset;
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated));
  }
  .provider:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .provider:focus-visible,
  .backend:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .ver {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }
  .desc,
  .backend span {
    font-size: var(--font-size-xs);
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .role {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--font-size-xs);
    color: color-mix(in srgb, var(--lane) 75%, var(--color-text-primary));
    background: color-mix(in srgb, var(--lane) 14%, transparent);
  }
  .backends {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
  }
  .none p {
    margin: 0;
    flex: 1;
    color: var(--color-text-secondary);
  }
  .none button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px 12px;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    font: inherit;
    cursor: pointer;
  }
  @media (max-width: 640px) {
    .backends {
      grid-template-columns: 1fr;
    }
  }
</style>
