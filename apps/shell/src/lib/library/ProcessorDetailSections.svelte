<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
  import type { TrackDetail } from '../../../shared/generation-record'
  import { capabilityName, detectedValue, jobStatus } from '../processors/presentation'

  let {
    detail,
    onretry,
    retrying
  }: {
    detail: TrackDetail
    onretry: (capability: ProcessorAnalysisCapability) => void
    retrying: ProcessorAnalysisCapability | null
  } = $props()
</script>

{#if detail.processorJobs?.length}
  <section>
    <h3>Detection status</h3>
    <dl>
      {#each detail.processorJobs as job (job.id)}
        <div>
          <dt>{job.capabilities.map(capabilityName).join(' and ')} detection</dt>
          <dd>{jobStatus(job)}</dd>
          <dt>Provider</dt>
          <dd>{job.pluginId} {job.pluginVersion}</dd>
          {#if job.status === 'error'}
            <dt>Reason</dt>
            <dd>{job.error?.message ?? 'Processor analysis failed.'}</dd>
            <dt>Retry</dt>
            <dd class="retry-actions">
              {#each job.capabilities as capability (capability)}
                <button disabled={retrying !== null} onclick={() => onretry(capability)}>
                  {retrying === capability ? 'Retrying…' : `Retry ${capabilityName(capability)}`}
                </button>
              {/each}
            </dd>
          {/if}
        </div>
      {/each}
    </dl>
  </section>
{/if}

{#if detail.processorResults?.length}
  <section>
    <h3>Detected audio evidence</h3>
    <p class="notice">
      Detected by a processor from the final audio; it does not replace requested values.
    </p>
    <dl>
      {#each detail.processorResults as result, i (i)}
        <div>
          <dt>{result.capability === 'bpm-detect' ? 'Detected BPM' : 'Detected key'}</dt>
          <dd>{detectedValue(result)}</dd>
          <dt>Provider</dt>
          <dd>{result.pluginId} {result.pluginVersion}</dd>
        </div>
      {/each}
    </dl>
  </section>
{/if}

<style>
  section {
    padding: 18px 0;
    border-top: 1px solid var(--color-border-default);
  }
  h3 {
    margin-top: 0;
    font-size: 14px;
  }
  .notice {
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  dl {
    margin: 0;
    display: grid;
    gap: 7px;
  }
  dl div {
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
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-primary);
    padding: 6px 11px;
  }
  button:hover {
    border-color: var(--color-accent);
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  button:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  .retry-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
