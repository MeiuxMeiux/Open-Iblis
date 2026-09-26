<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { StemJobView } from '../../../shared/stems'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import { backendText, clock, stageText } from './presentation'

  let {
    job,
    now,
    oncancel,
    onretry
  }: { job: StemJobView; now: number; oncancel: () => void; onretry: () => void } = $props()

  const active = $derived(job.status === 'queued' || job.status === 'running')
  const percent = $derived(Math.round(job.progress * 100))
  const STEPS = ['decoding', 'loading', 'separating', 'writing', 'verifying'] as const
  const stepIndex = $derived(STEPS.indexOf((job.stage ?? '') as (typeof STEPS)[number]))
</script>

{#if active}
  <div class="job" role="status" aria-live="polite">
    <div class="row">
      <span class="pulse" aria-hidden="true"><Icon name="stems" size={16} /></span>
      <div class="what">
        <strong>{stageText(job)}</strong>
        <span class="sub">
          {job.providerName}
          {#if job.runningOn}on {backendText(job.runningOn)}{/if}
          · {clock((now - job.createdAt) / 1000)} elapsed
        </span>
      </div>
      <span class="pct">{job.status === 'queued' ? '--' : `${percent}%`}</span>
      <Button size="sm" icon="close" onclick={oncancel} title="Stop separating; nothing is kept">
        Cancel
      </Button>
    </div>
    <div class="bar" aria-hidden="true">
      <span
        class="fill"
        class:indeterminate={job.status === 'queued'}
        style:width="{Math.max(3, percent)}%"
      ></span>
    </div>
    <ol class="steps" aria-label="Separation steps">
      {#each STEPS as step, i (step)}
        <li class:done={stepIndex > i} class:now={stepIndex === i}>{step}</li>
      {/each}
    </ol>
    {#if job.notice}<p class="notice">{job.notice}</p>{/if}
  </div>
{:else if job.status === 'error'}
  <div class="job failed" role="alert">
    <div class="row">
      <span class="icon"><Icon name="info" size={16} /></span>
      <div class="what">
        <strong>Separation did not finish</strong>
        <span class="sub">{job.error ?? 'The separator reported an error.'}</span>
      </div>
      <Button size="sm" icon="refresh" onclick={onretry}>Try again</Button>
    </div>
  </div>
{/if}

<style>
  .job {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border-default));
    border-radius: var(--radius-lg);
    background:
      radial-gradient(
        120% 140% at 0% 0%,
        color-mix(in srgb, var(--color-accent) 12%, transparent),
        transparent 60%
      ),
      var(--color-bg-inset);
  }
  .job.failed {
    border-color: color-mix(in srgb, var(--color-state-danger) 50%, var(--color-border-default));
    background: color-mix(in srgb, var(--color-state-danger) 7%, var(--color-bg-inset));
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .pulse,
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  }
  .icon {
    color: var(--color-state-danger);
    background: color-mix(in srgb, var(--color-state-danger) 15%, transparent);
  }
  .pulse {
    animation: pulse 1.6s var(--motion-ease-standard) infinite;
  }
  .what {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .what strong {
    font-size: var(--font-size-sm);
  }
  .sub {
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
  }
  .pct {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-md);
    color: var(--color-accent);
  }
  .bar {
    position: relative;
    height: 6px;
    margin-top: var(--space-3);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--color-bg-subtle);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      var(--stem-bass),
      var(--stem-other),
      var(--stem-drums),
      var(--stem-vocals)
    );
    transition: width var(--motion-duration-base) var(--motion-ease-standard);
  }
  .fill.indeterminate {
    width: 30% !important;
    animation: slide 1.4s var(--motion-ease-standard) infinite;
  }
  .steps {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    text-transform: capitalize;
  }
  .steps li.done {
    color: var(--color-text-secondary);
  }
  .steps li.now {
    color: var(--color-accent);
    font-weight: var(--font-weight-semibold);
  }
  .notice {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-xs);
    color: var(--color-state-warning);
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-accent) 12%, transparent);
    }
  }
  @keyframes slide {
    from {
      left: -30%;
    }
    to {
      left: 100%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse,
    .fill.indeterminate {
      animation: none;
    }
  }
</style>
