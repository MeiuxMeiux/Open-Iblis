<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // "Report this" beside an error message: opens the website bug form with
  // the app version, OS, and hardware line filled in by main. The error text
  // itself is not sent; the form asks the user to describe what happened.
  let failed = $state(false)

  async function report(): Promise<void> {
    const r = await window.iblis.feedback.open('bug', false)
    failed = !r.ok
  }
</script>

<button type="button" class="report" onclick={() => void report()}>
  Report this
</button>{#if failed}<span class="report-failed">
    (could not open the browser; use Settings, Feedback)</span
  >{/if}

<style>
  .report {
    margin-left: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent);
    font: inherit;
    font-size: 12px;
    text-decoration: underline;
    cursor: pointer;
  }
  .report:focus-visible {
    outline: 2px solid var(--color-focus-ring, var(--color-accent));
    outline-offset: 2px;
  }
  .report-failed {
    margin-left: 6px;
    font-size: 12px;
    color: var(--color-text-muted, inherit);
  }
</style>
