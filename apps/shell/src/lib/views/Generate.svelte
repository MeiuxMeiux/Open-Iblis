<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { EngineInfo } from '../../../shared/contract'
  import type { QueueComparisonVariant } from '../../../shared/generation-queue'
  import Sigil from '../Sigil.svelte'
  import PromptStarters from './PromptStarters.svelte'
  import SteeringControls from './SteeringControls.svelte'
  import { library } from '../library.svelte'
  import { createDraft } from '../create-draft.svelte'
  import { queue } from '../queue.svelte'
  import { resource } from '../resource.svelte'
  import QueuePanel from '../queue/QueuePanel.svelte'
  import GenerateActions from './GenerateActions.svelte'
  import EnginePicker from './EnginePicker.svelte'
  import CreateOptionsRow from './CreateOptionsRow.svelte'
  import LockBanner from '../ui/LockBanner.svelte'

  // Engine availability + live runtime profiles (null while loading).
  let info = $state<EngineInfo | null>(null)
  let loaded = $state(false)

  const draft = createDraft
  let seedError = $state<string | null>(null)

  // Remix hand-off: the Library view stashes a track's settings, we consume
  // them once on mount so the form comes up pre-filled.
  const remix = library.takeRemix()
  if (remix) draft.applyRemix(remix)

  async function loadInfo(): Promise<void> {
    const r = await window.iblis.engine.info()
    if (r.ok) {
      info = r.data
      draft.ensureEngineInfo(r.data)
    }
    loaded = true
  }

  // Poll engine status until it is running, so the form un-greys on its own once
  // the sidecar finishes loading its models (first launch can take a minute+) —
  // not just on the single mount-time fetch.
  $effect(() => {
    void resource.initialize()
  })

  $effect(() => {
    let stopped = false
    async function tick(): Promise<void> {
      await loadInfo()
      // On-demand engines are ready while stopped; keep polling only while a
      // boot-started engine is still warming up or facts are unavailable.
      const settled =
        !!info && (info.running || info.startsOnDemand) && !!info.runtime && !info.runtimeError
      if (!stopped && !settled) {
        setTimeout(() => void tick(), 1500)
      }
    }
    void tick()
    return () => {
      stopped = true
    }
  })

  const selectedProfile = $derived(
    info?.profiles.find((profile) => profile.id === draft.presetId) ?? null
  )
  const runtimeReady = $derived(
    !!info && (info.running || !!info.startsOnDemand) && !!info.runtime && !info.runtimeError
  )
  const canGenerate = $derived(runtimeReady && draft.prompt.trim().length > 0 && !resource.training)
  const actionLabel = $derived(queue.active || queue.pendingCount > 0 ? 'Add to queue' : 'Generate')

  async function generate(): Promise<void> {
    seedError = null
    const built = draft.buildRequest()
    if (!built.ok) {
      seedError = built.error
      return
    }
    if (!(await queue.enqueue(built.request))) seedError = queue.error
  }

  async function compare(variant: QueueComparisonVariant): Promise<void> {
    seedError = null
    const built = draft.buildRequest()
    if (!built.ok) {
      seedError = built.error
      return
    }
    if (!(await queue.compare(built.request, variant))) seedError = queue.error
  }

  function selectProfile(id: string): void {
    const profile = info?.profiles.find((candidate) => candidate.id === id)
    if (profile) draft.selectProfile(profile)
  }
</script>

<section class="generate">
  <header>
    <h1>Create</h1>
    <p class="lead">Describe a track. The engine composes, then renders it to audio.</p>
  </header>

  {#if resource.training}
    <LockBanner text={resource.detail} />
  {/if}

  {#if loaded && !info?.id}
    <div class="empty">
      <div class="sigil" aria-hidden="true"><Sigil size={44} /></div>
      <p class="muted">
        No engine is installed yet. Install the engine pack from Plugins to start generating.
      </p>
    </div>
  {:else}
    <div class="form" class:disabled={!runtimeReady}>
      {#if loaded && info?.id && !info.running && !info.startsOnDemand}
        <p class="warn">
          The engine is installed but not running yet — give it a moment, or reopen the app.
        </p>
      {/if}
      {#if info?.runtimeError}
        <p class="warn" role="alert">
          Engine settings are unavailable: {info.runtimeError} Generation stays disabled so no recipe
          is guessed.
        </p>
      {/if}

      <PromptStarters
        bind:prompt={draft.prompt}
        bind:negative={draft.steering.negative}
        disabled={!runtimeReady}
      />

      <EnginePicker onchanged={() => void loadInfo()} disabled={resource.training} />
      <CreateOptionsRow {info} {draft} ready={runtimeReady} onselectprofile={selectProfile} />

      <SteeringControls
        steering={draft.steering}
        profile={selectedProfile}
        runtime={info?.runtime ?? null}
        capabilities={info?.capabilities ?? null}
        disabled={!runtimeReady}
      />

      <GenerateActions
        profiles={info?.profiles ?? []}
        {canGenerate}
        {actionLabel}
        busy={!!queue.pendingAction}
        ongenerate={generate}
        oncompare={compare}
      />
    </div>

    {#if seedError}<p class="warn" role="alert">{seedError}</p>{/if}
  {/if}
  <QueuePanel />
</section>

<style>
  .generate {
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
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 40px 0;
  }
  .sigil {
    color: var(--color-accent);
    opacity: 0.5;
  }
  .muted {
    max-width: 420px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .warn {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-text-secondary);
  }
</style>
