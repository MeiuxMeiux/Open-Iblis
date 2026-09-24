<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type {
    TrainingAdvancedSettings,
    TrainingCategory,
    TrainingReserveResult,
    TrainingScanResult,
    TrainingVisibility
  } from '../../../shared/training'
  import AdvancedSettings from './AdvancedSettings.svelte'
  import Badge from '../ui/Badge.svelte'
  import ConsentStep from './ConsentStep.svelte'
  import NameStep from './NameStep.svelte'
  import PreflightChecklist from './PreflightChecklist.svelte'
  import { training } from '../training.svelte'

  let { onStarted }: { onStarted: () => void } = $props()

  let step = $state(1)
  let scan = $state<TrainingScanResult | null>(null)
  let scanning = $state(false)
  let name = $state('')
  let categories = $state<TrainingCategory[]>(['texture'])
  let reserve = $state<TrainingReserveResult | null>(null)
  let publicUpload = $state(false)
  let rights = $state(false)
  let advanced = $state<TrainingAdvancedSettings>({})
  let launching = $state(false)
  let error = $state<string | null>(null)
  // Main decides; community until it answers so nothing private is implied.
  let visibility = $state<TrainingVisibility>('community')
  const privateTraining = $derived(visibility === 'private')
  const consented = $derived(rights && (privateTraining || publicUpload))

  $effect(() => {
    void window.iblis.training.visibility().then((r) => {
      if (r.ok) visibility = r.data
    })
  })

  const stepLabels = $derived([
    'Songs',
    'Readiness',
    'Name',
    privateTraining ? 'Rights' : 'Sharing',
    'Start'
  ])

  const canPlan = $derived(!!scan && scan.preflight.ok && !!reserve?.available && consented)

  async function pickFolder(): Promise<void> {
    if (scanning) return
    scanning = true
    error = null
    const result = await window.iblis.training.scanFolder()
    scanning = false
    if (!result.ok) {
      error = result.error
      return
    }
    if (result.data) {
      scan = result.data
      step = 2
    }
  }

  async function launch(): Promise<void> {
    if (!scan || !reserve?.available || !reserve.trainingId || launching) return
    launching = true
    error = null
    const result = await training.start({
      folderToken: scan.folderToken,
      name: name.trim(),
      trainingId: reserve.trainingId,
      version: reserve.version ?? 1,
      categories,
      publicUploadAcknowledged: publicUpload,
      rightsAttested: rights,
      advanced: Object.values(advanced).some((v) => v !== undefined) ? advanced : undefined
    })
    launching = false
    if (!result.ok) {
      error = result.error ?? 'The training could not start.'
      return
    }
    onStarted()
  }

  function minutes(seconds: number): string {
    return `${Math.round(seconds / 60)} min`
  }
</script>

<div class="wizard">
  <ol class="steps" aria-label="New training steps">
    {#each stepLabels as label, index (label)}
      <li class:current={step === index + 1} class:done={step > index + 1}>{label}</li>
    {/each}
  </ol>

  {#if step === 1}
    <p class="explain">
      Point Iblis at a folder of your songs (.wav, .flac, or .mp3). Nothing uploads at this step —
      the folder is only scanned and counted.
    </p>
    <button class="primary" onclick={pickFolder} disabled={scanning}>
      {scanning ? 'Scanning…' : 'Choose folder…'}
    </button>
  {:else if step === 2 && scan}
    <div class="scan-summary">
      <span class="folder">{scan.folderName}</span>
      <Badge tone={scan.trackCount > 0 ? 'success' : 'danger'}>
        {scan.trackCount} tracks / {minutes(scan.totalDurationSec)}
      </Badge>
    </div>
    {#if scan.skipped.length > 0}
      <p class="explain">
        Skipped: {scan.skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}
      </p>
    {/if}
    <PreflightChecklist report={scan.preflight} />
    <div class="nav">
      <button class="quiet" onclick={() => (step = 1)}>Back</button>
      <button class="primary" onclick={() => (step = 3)} disabled={!scan.preflight.ok}>
        Continue
      </button>
    </div>
  {:else if step === 3}
    <NameStep
      bind:name
      bind:categories
      bind:reserve
      {privateTraining}
      onBack={() => (step = 2)}
      onContinue={() => (step = 4)}
    />
  {:else if step === 4}
    <ConsentStep bind:publicUpload bind:rights {privateTraining} />
    <div class="nav">
      <button class="quiet" onclick={() => (step = 3)}>Back</button>
      <button class="primary" onclick={() => (step = 5)} disabled={!consented}> Continue </button>
    </div>
  {:else if step === 5 && scan}
    <h3>Plan</h3>
    <ul class="plan">
      <li>{scan.trackCount} songs are prepared into stems and tagged locally.</li>
      {#if categories.includes('texture')}<li>
          A Texture style trains on the isolated stems.
        </li>{/if}
      {#if categories.includes('groove')}<li>A Groove style trains on the full mixes.</li>{/if}
      <li>Texture and Groove train one after the other, never at the same time.</li>
      <li>Generation stays paused for the whole run; the engine is stopped to free its memory.</li>
      {#if privateTraining}
        <li>The finished style is added to your Styles, marked Private.</li>
      {:else}
        <li>The finished style uploads to the community library, then appears in your Styles.</li>
      {/if}
      <li>
        Expect hours, not minutes, on an 8 GB GPU. Exact time estimates arrive once your first run
        calibrates them.
      </li>
    </ul>
    <AdvancedSettings bind:settings={advanced} vramTotalMb={scan.vramTotalMb} />
    <div class="nav">
      <button class="quiet" onclick={() => (step = 4)}>Back</button>
      <button class="primary" onclick={launch} disabled={!canPlan || launching}>
        {launching ? 'Starting…' : `Start training "${name.trim()}"`}
      </button>
    </div>
  {/if}

  {#if error}<p class="warn" role="alert">{error}</p>{/if}
</div>

<style>
  .wizard {
    display: flex;
    flex-direction: column;
    gap: 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
    padding: 16px 18px;
  }
  .steps {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .steps li {
    font-size: 12px;
    color: var(--color-text-secondary);
    padding: 3px 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
  }
  .steps li.current {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  .steps li.done {
    color: var(--color-text-primary);
  }
  .explain {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  .scan-summary {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .folder {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .plan {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .nav {
    display: flex;
    justify-content: space-between;
  }
  .primary {
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    padding: 9px 20px;
    border-radius: var(--radius-lg);
    font-size: 13.5px;
  }
  .primary:disabled {
    opacity: 0.4;
  }
  .quiet {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 9px 16px;
    border-radius: var(--radius-lg);
    font-size: 13px;
  }
  .warn {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-state-danger);
  }
</style>
