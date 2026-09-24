<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings → Diagnostics. Opt-in, off by default. Lets Jack (and, later,
  // consenting users) hand a redacted bundle of logs + app state back to the
  // developer so a bug like the greyed-out Create is debugged from data, not
  // memory. See docs/feature/diagnostics.md.
  import type { DiagLevel } from '../../../shared/contract'
  import EngineCompatibilityPanel from './EngineCompatibilityPanel.svelte'

  let level = $state<DiagLevel>('off')
  let note = $state('')
  let busy = $state(false)
  let result = $state<{ kind: 'ok'; ref: string } | { kind: 'err'; msg: string } | null>(null)

  $effect(() => {
    void window.iblis.diag.getLevel().then((r) => {
      if (r.ok) level = r.data
    })
  })

  const LEVELS: { id: DiagLevel; name: string; desc: string }[] = [
    { id: 'off', name: 'Off', desc: 'Nothing is ever sent. Default.' },
    {
      id: 'errors',
      name: 'Errors only',
      desc: 'System info, plugin/engine state, and logs around errors. Your prompts and track names are excluded.'
    },
    {
      id: 'verbose',
      name: 'Verbose',
      desc: 'Full session logs streamed live + crash reports, including your prompts. For active debugging sessions.'
    }
  ]

  async function choose(next: DiagLevel): Promise<void> {
    level = next
    await window.iblis.diag.setLevel(next)
  }

  async function send(): Promise<void> {
    busy = true
    result = null
    const r = await window.iblis.diag.send(note.trim() || undefined)
    busy = false
    result = r.ok ? { kind: 'ok', ref: r.data.ref } : { kind: 'err', msg: r.error }
  }
</script>

<section class="group">
  <h2>Diagnostics</h2>
  <p class="hint">
    Off by default. When on, Iblis can upload a redacted bundle of logs and app state to help debug
    a problem you report. Nothing is sent unless you enable it.
  </p>

  <div class="levels">
    {#each LEVELS as opt (opt.id)}
      <button
        type="button"
        class="lvl"
        class:active={level === opt.id}
        aria-pressed={level === opt.id}
        onclick={() => choose(opt.id)}
      >
        <span class="name">{opt.name}</span>
        <span class="desc">{opt.desc}</span>
      </button>
    {/each}
  </div>

  {#if level !== 'off'}
    <div class="send">
      <label class="field">
        <span>Note (optional — what went wrong?)</span>
        <textarea
          bind:value={note}
          rows="2"
          placeholder="e.g. Create stays greyed out after install"></textarea>
      </label>
      <button class="go" disabled={busy} onclick={send}>
        {busy ? 'Sending…' : 'Send diagnostics now'}
      </button>
      {#if result?.kind === 'ok'}
        <p class="ok">Sent. Reference <code>{result.ref}</code> — share it with the developer.</p>
      {:else if result?.kind === 'err'}
        <p class="err">Couldn't send: {result.msg}</p>
      {/if}
    </div>
  {/if}

  <EngineCompatibilityPanel />
</section>

<style>
  .group h2 {
    margin: 0;
    font-size: 13px;
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .hint {
    margin: 6px 0 16px;
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .levels {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .lvl {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    padding: 11px 13px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  .lvl:hover {
    background: var(--app-surface-hover);
  }
  .lvl.active {
    border-color: var(--color-accent);
  }
  .lvl .name {
    font-size: 14px;
    color: var(--color-text-primary);
  }
  .lvl .desc {
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
  .send {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field span {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  textarea {
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    padding: 9px 11px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
  }
  .go {
    align-self: flex-start;
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    padding: 8px 18px;
    border-radius: var(--radius-lg);
    font-size: 13px;
  }
  .go:disabled {
    opacity: 0.5;
  }
  .ok {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-text-primary);
    /* The ref + message must be copyable (the whole point of showing them). */
    user-select: text;
  }
  .ok code {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    user-select: all;
  }
  .err {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-danger, #e0564a);
    user-select: text;
  }
</style>
