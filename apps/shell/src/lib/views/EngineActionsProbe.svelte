<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings -> Engine -> Creation-actions probe. A developer gate, not a user
  // workflow: it proves on THIS machine that the installed engine honors the
  // repaint/outpaint task before any Extend UI is built on top of it. See
  // docs/feature/creation-actions.md slice 1.
  import type { EngineActionsProbeEvidence } from '../../../shared/engine-actions'
  import Badge from '../ui/Badge.svelte'
  import ProbeAudioPlayer from './ProbeAudioPlayer.svelte'

  let evidence = $state<EngineActionsProbeEvidence | null>(null)
  let busy = $state(false)
  let error = $state<string | null>(null)

  $effect(() => {
    void window.iblis.engineActions.evidence().then((r) => {
      if (r.ok) evidence = r.data
    })
  })

  async function run(): Promise<void> {
    if (busy) return
    busy = true
    error = null
    const result = await window.iblis.engineActions.probe()
    if (result.ok) evidence = result.data
    else error = result.error
    busy = false
  }

  function stamp(ms: number): string {
    return new Date(ms).toLocaleString()
  }
</script>

<section class="group" aria-labelledby="actions-probe-heading">
  <h2 id="actions-probe-heading">Creation-actions probe</h2>
  <p class="hint">
    Sends a short generated test clip through the engine's extend path and checks the returned
    duration. A passing duration check still needs a human continuity listen before Extend can be
    built — the probe changes nothing in your library.
  </p>

  {#if evidence}
    <div class="result" class:passed={evidence.passed}>
      <div class="head">
        <Badge tone={evidence.passed ? 'accent' : 'neutral'}>
          {evidence.passed ? 'Duration check passed' : 'Duration check failed'}
        </Badge>
        <span class="meta">
          engine {evidence.engineVersion ?? 'unknown'} — {stamp(evidence.ranAt)}
        </span>
      </div>
      <p class="note">{evidence.note}</p>
      <p class="meta">
        {evidence.sourceSec}s source + {evidence.requestedExtendSec}s requested extension returned {evidence.outputSec.toFixed(
          2
        )}s in {(evidence.elapsedMs / 1000).toFixed(1)}s.
      </p>
      {#if evidence.mediaAvailable}
        <div class="listen">
          <p class="note">
            Compare the deterministic source with the returned take, then listen for a click,
            silence, or musical break where the extension begins at {evidence.sourceSec}s.
          </p>
          {#key evidence.ranAt}
            <ProbeAudioPlayer
              label="Original probe source"
              src={`iblis-probe://source?run=${evidence.ranAt}`}
            />
            <ProbeAudioPlayer
              label="Returned extended result"
              src={`iblis-probe://result?run=${evidence.ranAt}`}
              boundarySec={evidence.sourceSec}
            />
          {/key}
        </div>
      {:else}
        <p class="warn">
          This result predates playable probe evidence. Run the probe again to create the source and
          returned audio.
        </p>
      {/if}
    </div>
  {/if}

  {#if error}<p class="warn" role="alert">{error}</p>{/if}

  <div>
    <button type="button" class="run" onclick={run} disabled={busy}>
      {busy ? 'Probing the engine…' : evidence ? 'Run probe again' : 'Run probe'}
    </button>
  </div>
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 28px;
  }
  .group h2 {
    margin: 0;
    font-size: 13px;
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .hint,
  .note,
  .warn {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  .result {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  .listen {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .result.passed {
    border-color: var(--color-accent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .meta {
    margin: 0;
    font-size: 11.5px;
    color: var(--color-text-muted);
  }
  .run {
    padding: 8px 14px;
    font-size: 13px;
    color: var(--color-text-primary);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
  }
  .run:hover:not(:disabled) {
    background: var(--app-surface-hover);
    border-color: var(--color-accent);
  }
  .run:disabled {
    opacity: 0.6;
  }
</style>
