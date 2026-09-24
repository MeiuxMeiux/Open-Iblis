<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { TrainingPackState } from '../../../shared/training'
  import { TRAINING_LOCKS_GENERATION } from '../../../shared/training'
  import { resource } from '../resource.svelte'
  import { training } from '../training.svelte'
  import LockBanner from '../ui/LockBanner.svelte'
  import PackGate from '../training/PackGate.svelte'
  import PreflightChecklist from '../training/PreflightChecklist.svelte'
  import TrainingWizard from '../training/TrainingWizard.svelte'
  import JobProgress from '../training/JobProgress.svelte'
  import JobHistory from '../training/JobHistory.svelte'

  let pack = $state<TrainingPackState | null>(null)
  let loaded = $state(false)
  let wizardOpen = $state(false)

  async function loadPack(): Promise<void> {
    const result = await window.iblis.training.packState()
    if (result.ok) pack = result.data
    loaded = true
  }

  $effect(() => {
    void loadPack()
    void resource.initialize()
    void training.initialize()
  })
</script>

<section class="training">
  <header>
    <h1>Training</h1>
    <p class="lead">
      Train Texture and Groove styles on your own songs, locally, and share them with the Iblis
      community.
    </p>
  </header>

  {#if resource.training}
    <LockBanner text={TRAINING_LOCKS_GENERATION} />
  {/if}

  {#if loaded && !pack?.installed}
    <PackGate onInstalled={loadPack} />
  {:else if loaded}
    {#if training.active}
      <JobProgress job={training.active} />
    {:else if wizardOpen}
      <TrainingWizard onStarted={() => (wizardOpen = false)} />
    {:else}
      <button class="new" onclick={() => (wizardOpen = true)}>New training…</button>
      <PreflightChecklist />
    {/if}
    <JobHistory jobs={training.history} />
  {/if}
</section>

<style>
  .training {
    max-width: 640px;
    margin: 0 auto;
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
  }
  .lead {
    margin: 6px 0 0;
    font-size: 13.5px;
    color: var(--color-text-secondary);
  }
  .new {
    align-self: flex-start;
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    padding: 9px 22px;
    border-radius: var(--radius-lg);
    font-size: 14px;
  }
</style>
