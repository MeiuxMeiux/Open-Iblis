<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings → Appearance: the skin picker. Switching a skin applies it live,
  // re-applies that skin's saved token edits, and persists the choice. Built-in
  // skins plus any installed `kind:"skin"` plugins share one picker. The
  // per-token editor + .iblis-skin export/import live in <SkinEditor>.
  import { onMount } from 'svelte'
  import { SKINS, applySkin, readSkin, writeSkin } from '../skins/skins'
  import { applyOverrides } from '../skins/editor'
  import {
    installedToShellSkin,
    installedSkinIds,
    readCachedInstalledSkins,
    syncInstalledSkins
  } from '../skins/installed'
  import type { InstalledSkin } from '../../../shared/contract'
  import SkinEditor from '../skins/SkinEditor.svelte'
  import Badge from '../ui/Badge.svelte'

  // Seed from the cache (instant), then refresh from the verified on-disk
  // descriptors after mount.
  let installed = $state<InstalledSkin[]>(readCachedInstalledSkins())
  const extra = $derived(installedSkinIds(installed))
  const skins = $derived([...SKINS, ...installed.map(installedToShellSkin)])

  let current = $state(readSkin(undefined, installedSkinIds(readCachedInstalledSkins())))

  onMount(async () => {
    installed = await syncInstalledSkins()
  })

  function choose(id: string): void {
    current = id
    applySkin(id, undefined, extra) // live — every token-driven component recomputes
    applyOverrides(id) // re-apply this skin's edits, clear the previous skin's
    writeSkin(id, undefined, extra) // persisted for next launch
  }
</script>

<section class="group">
  <h2>Appearance</h2>
  <p class="hint">Skins restyle the whole shell. Your choice is remembered.</p>

  <div class="grid">
    {#each skins as skin (skin.id)}
      <button
        type="button"
        class="skin"
        class:active={current === skin.id}
        aria-pressed={current === skin.id}
        onclick={() => choose(skin.id)}
      >
        <span class="swatches" aria-hidden="true">
          {#each skin.swatches as color (color)}
            <span class="chip" style:background={color}></span>
          {/each}
        </span>
        <span class="label">
          <span class="name">
            {skin.name}{#if skin.installed}<Badge caps>plugin</Badge>{/if}
          </span>
          <span class="vibe">{skin.vibe}</span>
        </span>
      </button>
    {/each}
  </div>

  <SkinEditor skinId={current} onChooseSkin={choose} />
</section>

<style>
  .group h2 {
    margin: 0;
    font-size: 13px;
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .hint {
    margin: 6px 0 16px;
    font-size: 13px;
    color: var(--color-text-secondary);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: var(--space-3);
  }

  .skin {
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    padding: 12px 14px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    transition:
      border-color var(--motion-duration-fast) ease,
      background var(--motion-duration-fast) ease;
  }
  .skin:hover {
    background: var(--app-surface-hover);
  }
  .skin.active {
    border-color: var(--color-accent);
  }

  .swatches {
    display: flex;
    flex: 0 0 auto;
    border-radius: var(--radius-sm);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }
  .chip {
    width: 12px;
    height: 30px;
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 14px;
    color: var(--color-text-primary);
  }
  .vibe {
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
</style>
