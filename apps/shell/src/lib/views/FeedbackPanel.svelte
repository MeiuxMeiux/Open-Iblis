<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings -> Feedback. Each action asks main to open the website form in
  // the system browser; main builds the URL (version, build, OS, and the
  // diagnostics reference when attached). The renderer never assembles a URL.
  import type { FeedbackKind } from '../../../shared/feedback'
  import Button from '../ui/Button.svelte'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'

  let diagRef = $state<string | null>(null)
  let attachDiag = $state(false)
  let notice = $state<string | null>(null)
  let busy = $state(false)

  $effect(() => {
    void window.iblis.feedback.lastDiagRef().then((r) => {
      if (r.ok) diagRef = r.data
    })
  })

  async function open(kind: FeedbackKind): Promise<void> {
    busy = true
    notice = null
    const r = await window.iblis.feedback.open(kind, attachDiag && diagRef !== null)
    busy = false
    notice = r.ok ? 'The form opened in your browser.' : `The form could not be opened: ${r.error}`
  }
</script>

<section class="group" aria-labelledby="feedback-heading">
  <h2 id="feedback-heading">Feedback</h2>
  <p class="hint">
    Reports go to a short form on the Iblis website. Your app version, build, and operating system
    are filled in for you. Nothing is sent until you submit the form.
  </p>

  <div class="row">
    <Button variant="primary" icon="shield" disabled={busy} onclick={() => void open('bug')}>
      Report a bug
    </Button>
    <Button icon="star" disabled={busy} onclick={() => void open('feature')}>
      Request a feature
    </Button>
    <Button variant="ghost" disabled={busy} onclick={() => void open('question')}>
      Ask a question
    </Button>
  </div>

  <div class="attach">
    <ToggleSwitch
      bind:checked={attachDiag}
      disabled={diagRef === null}
      label="Attach my latest diagnostics reference"
      description={diagRef !== null
        ? `Adds ${diagRef} to the form so the report and its logs connect.`
        : 'None sent yet. Send one from Settings, Diagnostics first.'}
    />
  </div>

  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
</section>

<style>
  .group h2 {
    margin: 0 0 var(--space-2);
  }
  .hint {
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-3);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }
  .attach {
    margin-top: var(--space-3);
  }
  .notice {
    margin: var(--space-3) 0 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }
</style>
