<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { AdapterOffer } from '../../../shared/adapters'
  import Badge from '../ui/Badge.svelte'
  import Button from '../ui/Button.svelte'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'

  let {
    offer,
    installed,
    busy,
    progress,
    acknowledged,
    onAcknowledge,
    onAdd
  }: {
    offer: AdapterOffer
    installed: boolean
    busy: boolean
    progress: number | null
    acknowledged: boolean
    onAcknowledge: (checked: boolean) => void
    onAdd: () => void
  } = $props()

  let experimental = $derived(offer.lane === 'experimental')
  let compatibility = $derived(
    offer.compatibility === 'different-model'
      ? 'Different engine model'
      : offer.compatibility === 'matches-active-pack'
        ? 'Matches active pack'
        : 'Compatibility unproven'
  )
  let rights = $derived(
    offer.rights === 'research-only'
      ? 'Research terms'
      : offer.rights === 'commercial-claim'
        ? 'Publisher terms'
        : 'Terms not supplied'
  )
</script>

<article class="style-card" class:busy>
  <div class="headline">
    <div class="names">
      <h3>{offer.name}</h3>
      <p class="maker">{offer.maker}</p>
    </div>
    <div class="badges" aria-label="Style status">
      <Badge tone={experimental ? 'warning' : 'accent'} variant="outline">
        {experimental ? 'Experimental' : 'Community'}
      </Badge>
      <Badge>{rights}</Badge>
    </div>
  </div>

  <p class="description">{offer.description}</p>

  <div class="metadata" aria-label="Style details">
    <span>{compatibility}</span>
    <span>{offer.format === 'peft' ? 'PEFT adapter' : 'Safetensors'}</span>
    {#if offer.trigger}<span>Prompt cue: {offer.trigger}</span>{/if}
  </div>

  {#if offer.tags.length > 0}
    <div class="tags" aria-label="Style tags">
      {#each offer.tags as tag (tag)}<Badge>{tag}</Badge>{/each}
    </div>
  {/if}

  {#if offer.installable && !installed}
    <label class="ack">
      <ToggleSwitch compact checked={acknowledged} onToggle={onAcknowledge} label="" />
      <span
        >I understand the risks — this is a community style and may not behave as described.</span
      >
    </label>
  {/if}

  <footer>
    {#if installed}
      <Badge tone="success" variant="outline">In library</Badge>
    {:else if offer.installable}
      <Button variant="primary" icon="download" disabled={busy || !acknowledged} onclick={onAdd}>
        {#if busy}
          {progress === null ? 'Starting' : `Adding ${progress}%`}
        {:else if !acknowledged}
          Acknowledge to add
        {:else}
          Add to library
        {/if}
      </Button>
    {:else}
      <p class="unavailable">{offer.availabilityNote}</p>
    {/if}
    <Button variant="ghost" size="sm" icon="info" href={offer.sourceUrl}>Source and terms</Button>
  </footer>
</article>

<style>
  .style-card {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    box-shadow: var(--shadow-sm);
  }
  .style-card.busy {
    opacity: 0.7;
  }
  h3,
  p {
    margin: 0;
  }
  .headline {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .names {
    min-width: 0;
  }
  h3 {
    color: var(--color-text-primary);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
  }
  .maker {
    margin-top: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  .badges,
  .tags,
  .metadata {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .badges {
    justify-content: flex-end;
    flex: none;
  }
  .description {
    max-width: 680px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
  .metadata {
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  .metadata span + span::before {
    content: '·';
    margin-right: var(--space-2);
    color: var(--color-text-muted);
  }

  .ack {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.5;
    cursor: pointer;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-1);
    border-top: 1px solid var(--color-border-subtle);
    padding-top: var(--space-3);
  }
  footer :global(.badge) {
    margin-right: auto;
  }
  .unavailable {
    margin-right: auto;
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.4;
  }

  @media (max-width: 620px) {
    .headline {
      flex-direction: column;
    }
    .badges {
      justify-content: flex-start;
    }
    footer {
      align-items: stretch;
      flex-direction: column;
    }
    footer :global(.badge) {
      margin-right: 0;
      align-self: flex-start;
    }
  }
</style>
