<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { TrainingJobView, TrainingStageName } from '../../../shared/training'
  import Badge from '../ui/Badge.svelte'
  import { training } from '../training.svelte'

  let { job }: { job: TrainingJobView } = $props()
  let cancelling = $state(false)

  const STAGE_LABELS: Record<TrainingStageName, string> = {
    scan: 'Reading songs',
    stems: 'Extracting stems',
    tag: 'Tagging structure and BPM',
    dataset: 'Building datasets',
    'train-texture': 'Training Texture',
    'train-groove': 'Training Groove',
    export: 'Exporting the style',
    upload: 'Uploading to the community library',
    pulldown: 'Adding it to your Styles',
    register: 'Adding it to your Styles'
  }

  // The live progress event refines the persisted stage rows between saves.
  const live = $derived(training.progress?.jobId === job.id ? training.progress : null)

  function percent(stage: { name: TrainingStageName; percent: number; status: string }): number {
    if (live?.stage === stage.name && stage.status === 'active') return live.percent
    return stage.percent
  }

  function detail(stage: {
    name: TrainingStageName
    detail?: string
    status: string
  }): string | null {
    if (live?.stage === stage.name && stage.status === 'active') return live.detail
    return stage.detail ?? null
  }

  async function cancel(): Promise<void> {
    cancelling = true
    await training.cancel(job.id)
  }
</script>

<div class="progress">
  <div class="head">
    <h2>Training "{job.name}"</h2>
    {#if job.status === 'running'}
      <button class="cancel" onclick={cancel} disabled={cancelling}>
        {cancelling ? 'Stopping after this step…' : 'Cancel training'}
      </button>
    {/if}
  </div>
  <ol class="stages">
    {#each job.stages as stage (stage.name)}
      <li class="stage" class:active={stage.status === 'active'}>
        <div class="row">
          <span class="label">{STAGE_LABELS[stage.name]}</span>
          {#if stage.status === 'done'}
            <Badge tone="success">Done</Badge>
          {:else if stage.status === 'active'}
            <Badge tone="accent">{Math.round(percent(stage))}%</Badge>
          {:else if stage.status === 'failed'}
            <Badge tone="danger">Failed</Badge>
          {:else if stage.status === 'skipped'}
            <Badge tone="neutral">Skipped</Badge>
          {:else}
            <Badge tone="neutral" variant="outline">Queued</Badge>
          {/if}
        </div>
        <div
          class="bar"
          role="progressbar"
          aria-valuenow={Math.round(percent(stage))}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label={STAGE_LABELS[stage.name]}
        >
          <div class="fill" style={`width:${percent(stage)}%`}></div>
        </div>
        {#if stage.status === 'active' && detail(stage)}
          <p class="detail">{detail(stage)}</p>
        {/if}
        {#if stage.status === 'failed' && stage.error}
          <p class="detail">{stage.error}</p>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
    padding: 16px 18px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .cancel {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 6px 14px;
    border-radius: var(--radius-lg);
    font-size: 12.5px;
  }
  .cancel:disabled {
    opacity: 0.5;
  }
  .stages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .label {
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .stage.active .label {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .bar {
    margin-top: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--color-bg-subtle);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.4s ease;
  }
  .detail {
    margin: 5px 0 0;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
</style>
