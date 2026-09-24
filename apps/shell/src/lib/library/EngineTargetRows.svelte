<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { ResolvedGenerationRecipe } from '../../../shared/generation-record'

  // Exact engine target facts for a contract-v2 take, from the persisted
  // generation record: operation, provider, signed descriptor hash, resolved
  // model, bounded advanced controls, and any extra output kept. Rendered
  // inside the Generation definition list of the track detail drawer.
  let { recipe }: { recipe: ResolvedGenerationRecipe | undefined } = $props()

  const advanced = $derived.by((): [string, string][] => {
    const raw = recipe?.advanced
    if (typeof raw !== 'string') return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value)
      ])
    } catch {
      return []
    }
  })

  const hash = $derived(
    typeof recipe?.descriptor_hash === 'string' ? recipe.descriptor_hash.slice(0, 12) : null
  )
</script>

{#if recipe?.operation}
  <div>
    <dt>Operation</dt>
    <dd>{recipe.operation}</dd>
  </div>
{/if}
{#if recipe?.provider_id}
  <div>
    <dt>Provider</dt>
    <dd>{recipe.provider_id}{recipe.engine_family ? ` (${recipe.engine_family})` : ''}</dd>
  </div>
{/if}
{#if recipe?.model_id}
  <div>
    <dt>Model</dt>
    <dd>{recipe.model_id}{recipe.model_revision ? `@${recipe.model_revision}` : ''}</dd>
  </div>
{/if}
{#if hash}
  <div>
    <dt>Signed capabilities</dt>
    <dd><code>{hash}</code></dd>
  </div>
{/if}
{#each advanced as [key, value] (key)}
  <div>
    <dt>{key}</dt>
    <dd>{value}</dd>
  </div>
{/each}
{#if recipe?.preview_output}
  <div>
    <dt>Preview output</dt>
    <dd>kept ({recipe.preview_output})</dd>
  </div>
{/if}

<style>
  /* The drawer's scoped dl rules do not reach a child component; the row
     grid is repeated here so these rows align with the ones around them. */
  div {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) minmax(0, 2fr);
    gap: 12px;
  }
  dt {
    color: var(--color-text-secondary);
    font-size: 11.5px;
  }
  dd {
    margin: 0;
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
  code {
    font-size: 11.5px;
  }
</style>
