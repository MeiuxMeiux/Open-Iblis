<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { TrainingJobStatus, TrainingJobView } from '../../../shared/training'
  import Badge from '../ui/Badge.svelte'
  import { training } from '../training.svelte'

  let { jobs }: { jobs: TrainingJobView[] } = $props()

  const CHIP: Record<
    TrainingJobStatus,
    { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }
  > = {
    running: { label: 'Running', tone: 'accent' },
    interrupted: { label: 'Interrupted', tone: 'warning' },
    'awaiting-upload': { label: 'Awaiting upload', tone: 'warning' },
    uploading: { label: 'Uploading', tone: 'accent' },
    live: { label: 'Live', tone: 'success' },
    saved: { label: 'Private', tone: 'success' },
    failed: { label: 'Failed', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'neutral' }
  }

  function bytes(job: TrainingJobView): string | null {
    if (job.artifacts.length === 0) return null
    const total = job.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0)
    return `${(total / (1024 * 1024)).toFixed(0)} MB`
  }

  function when(job: TrainingJobView): string {
    return new Date(job.createdAt).toLocaleDateString()
  }

  // The tier + rank the pack actually trained at (same across categories).
  function profileLine(job: TrainingJobView): string | null {
    const first = job.profiles && Object.values(job.profiles)[0]
    if (!first) return null
    return `${first.tier} tier / rank ${first.rank} / ${first.optimizer}`
  }
</script>

{#if jobs.length > 0}
  <div class="history">
    <h2>Past trainings</h2>
    <ul>
      {#each jobs as job (job.id)}
        <li>
          <div class="main">
            <span class="name">{job.name}</span>
            <span class="meta">
              {job.categories.join(' + ')} / {when(job)}{#if bytes(job)}&nbsp;/ {bytes(job)}{/if}
            </span>
            {#if profileLine(job)}<span class="profile">{profileLine(job)}</span>{/if}
          </div>
          <div class="actions">
            <Badge tone={CHIP[job.status].tone}>{CHIP[job.status].label}</Badge>
            {#if job.status === 'interrupted' || job.status === 'failed'}
              <button onclick={() => training.resume(job.id)}>Resume</button>
            {/if}
            {#if job.status === 'awaiting-upload'}
              <button onclick={() => training.retryUpload(job.id)}>Retry upload</button>
            {/if}
            {#if job.status !== 'running'}
              <button onclick={() => training.deleteJob(job.id)}>Delete</button>
            {/if}
          </div>
          {#if job.error}<p class="error">{job.error}</p>{/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .history {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
    padding: 10px 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .meta {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .profile {
    font-size: 11px;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions button {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 5px 12px;
    border-radius: var(--radius-lg);
    font-size: 12px;
  }
  .actions button:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }
  .error {
    flex-basis: 100%;
    margin: 0;
    font-size: 12px;
    color: var(--color-state-danger);
  }
</style>
