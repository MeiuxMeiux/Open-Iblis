<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings → Engine performance. The one hardware lever the app cleanly owns:
  // how many CPU threads a native engine may use (OMP_NUM_THREADS). On marginal
  // hardware an all-core generation can stress the CPU into a BSOD, so users on
  // shakier machines can dial it down and still get a result. Applied at engine
  // spawn, so a change needs an engine restart (the "Apply" button below).
  import type { PerfInfo, PerfProfile } from '../../../shared/contract'

  let info = $state<PerfInfo | null>(null)
  let customThreads = $state(1)
  let needsRestart = $state(false)
  let restarting = $state(false)
  let restartErr = $state<string | null>(null)

  $effect(() => {
    void window.iblis.perf.info().then((r) => {
      if (!r.ok) return
      info = r.data
      // Pre-fill the custom input with the saved value, or balanced as a sane start.
      customThreads = r.data.settings.customThreads || r.data.threads.balanced
    })
  })

  const PROFILES: { id: PerfProfile; name: string; desc: string }[] = [
    {
      id: 'safe',
      name: 'Safe',
      desc: 'Heavily throttled. Use this if a generation crashes, freezes, or blue-screens your PC.'
    },
    { id: 'balanced', name: 'Balanced', desc: 'Leaves 2 cores free for the system. The default.' },
    {
      id: 'max',
      name: 'Maximum',
      desc: 'Every core. Fastest CPU phases, but the most heat and power draw on your processor.'
    },
    {
      id: 'custom',
      name: 'Custom',
      desc: 'Set the exact number of CPU threads the engine may use.'
    }
  ]

  // Concrete thread count a profile resolves to on this machine, for the labels.
  function threadsFor(profile: PerfProfile): number {
    if (!info) return 0
    if (profile === 'custom') return Math.min(Math.max(customThreads || 1, 1), info.logicalCores)
    return info.threads[profile]
  }

  async function commit(profile: PerfProfile): Promise<void> {
    const r = await window.iblis.perf.set({ profile, customThreads })
    if (r.ok) {
      info = r.data
      needsRestart = true
    }
  }

  function choose(profile: PerfProfile): void {
    void commit(profile)
  }

  // Re-commit a custom thread count as the number input changes.
  function onCustomInput(): void {
    if (info)
      customThreads = Math.min(Math.max(Math.trunc(customThreads) || 1, 1), info.logicalCores)
    void commit('custom')
  }

  async function apply(): Promise<void> {
    restarting = true
    restartErr = null
    const r = await window.iblis.perf.restartEngine()
    restarting = false
    if (r.ok) needsRestart = false
    else restartErr = r.error
  }
</script>

<section class="group">
  <h2>Engine performance</h2>
  <p class="hint">
    How hard a generation drives your CPU. On some machines an all-core run can overheat or crash
    the system — if that happens to you, lower this. {#if info}This PC has {info.logicalCores} CPU threads.{/if}
  </p>

  <div class="levels">
    {#each PROFILES as opt (opt.id)}
      <button
        type="button"
        class="lvl"
        class:active={info?.settings.profile === opt.id}
        aria-pressed={info?.settings.profile === opt.id}
        onclick={() => choose(opt.id)}
      >
        <span class="row">
          <span class="name">{opt.name}</span>
          {#if info && opt.id !== 'custom'}
            <span class="threads">{threadsFor(opt.id)} threads</span>
          {/if}
        </span>
        <span class="desc">{opt.desc}</span>
      </button>
    {/each}
  </div>

  {#if info?.settings.profile === 'custom'}
    <label class="field custom">
      <span>CPU threads (1–{info.logicalCores})</span>
      <input
        type="number"
        min="1"
        max={info.logicalCores}
        bind:value={customThreads}
        onchange={onCustomInput}
      />
    </label>
  {/if}

  {#if needsRestart}
    <div class="apply">
      <p class="pending">Restart the engine to apply the new thread limit.</p>
      <button class="go" disabled={restarting} onclick={apply}>
        {restarting ? 'Restarting…' : 'Apply & restart engine'}
      </button>
      {#if restartErr}<p class="err">Couldn't restart: {restartErr}</p>{/if}
    </div>
  {/if}
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
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .lvl .name {
    font-size: 14px;
    color: var(--color-text-primary);
  }
  .threads {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }
  .lvl .desc {
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field.custom {
    margin-top: 12px;
  }
  .field span {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  input {
    width: 120px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    padding: 8px 11px;
    font-size: 13px;
    font-family: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .apply {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pending {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-text-secondary);
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
  .err {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-danger, #e0564a);
    user-select: text;
  }
</style>
