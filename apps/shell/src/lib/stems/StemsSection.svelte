<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { StemRole } from '@iblis/plugin-sdk'
  import type { IpcResult } from '../../../shared/contract'
  import type { StemProviderView, TrackStemsView } from '../../../shared/stems'
  import { nav } from '../navigation.svelte'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import StemJobCard from './StemJobCard.svelte'
  import StemSetPanel from './StemSetPanel.svelte'
  import { setSummary } from './presentation'

  let { trackId, format }: { trackId: string; format: string } = $props()

  let view = $state<TrackStemsView>({ sets: [] })
  let providers = $state<StemProviderView[]>([])
  let chosen = $state('')
  let selectedSet = $state('')
  let error = $state<string | null>(null)
  let busy = $state(false)
  let loaded = $state(false)
  // Whether the signed catalog offers any separator; null until checked.
  let offered = $state<boolean | null>(null)
  let now = $state(Date.now())
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  const jobActive = (v: TrackStemsView): boolean =>
    v.job?.status === 'queued' || v.job?.status === 'running'
  const active = $derived(jobActive(view))
  const set = $derived(view.sets.find((s) => s.id === selectedSet) ?? view.sets[0])
  const summary = $derived(set ? setSummary(set) : {})
  const ready = $derived(providers.filter((p) => p.ready))
  const supported = $derived(format.toLowerCase() === 'wav')

  function failed(cause: unknown): IpcResult<never> {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }

  function accept(result: IpcResult<TrackStemsView>): void {
    if (!result.ok) {
      error = result.error
      return
    }
    const hadJob = jobActive(view)
    view = result.data
    if (hadJob && !jobActive(view) && view.sets[0]) selectedSet = view.sets[0].id
    schedule()
  }

  function schedule(): void {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    if (!active) return
    pollTimer = setTimeout(() => void refresh(), 800)
  }

  async function refresh(): Promise<void> {
    accept(await window.iblis.stems.track(trackId).catch(failed))
  }

  async function loadProviders(): Promise<void> {
    const snap = await window.iblis.stems.snapshot().catch(failed)
    if (!snap.ok) return
    providers = snap.data.providers
    const preferred = snap.data.settings.defaultProvider
    if (!snap.data.providers.length) void checkCatalog()
    chosen =
      ready.find((p) => p.id === preferred)?.id ??
      ready.find((p) => p.model === 'htdemucs')?.id ??
      ready[0]?.id ??
      ''
  }

  async function checkCatalog(): Promise<void> {
    const result = await window.iblis.catalog.list().catch(failed)
    offered =
      result.ok &&
      result.data.plugins.some(
        (p) => p.manifest.kind === 'processor' && p.manifest.capabilities.includes('stem-split')
      )
  }

  onMount(() => {
    void Promise.all([refresh(), loadProviders()]).then(() => (loaded = true))
    const clockTimer = setInterval(() => (now = Date.now()), 1000)
    return () => {
      clearInterval(clockTimer)
      if (pollTimer) clearTimeout(pollTimer)
    }
  })

  async function act(run: () => Promise<IpcResult<TrackStemsView>>): Promise<void> {
    if (busy) return
    busy = true
    error = null
    accept(await run().catch(failed))
    busy = false
  }

  async function simple(run: () => Promise<IpcResult<unknown>>): Promise<void> {
    const result = await run().catch(failed)
    if (!result.ok) error = result.error
  }

  const split = () => act(() => window.iblis.stems.split(trackId, chosen || undefined))
  const cancel = () => act(() => window.iblis.stems.cancel(trackId))
  const remove = (setId: string) => act(() => window.iblis.stems.remove(trackId, setId))
  const drag = (setId: string, role: StemRole) =>
    simple(() => window.iblis.stems.dragOut(trackId, setId, role))
  const reveal = (setId: string, role: StemRole) =>
    simple(() => window.iblis.stems.reveal(trackId, setId, role))
  const exportSet = (setId: string) => simple(() => window.iblis.stems.exportSet(trackId, setId))
</script>

<section class="stems" aria-labelledby="stems-title">
  <header>
    <h3 id="stems-title"><Icon name="stems" size={16} />Stems</h3>
    {#if summary.bpm}
      <span class="fact" title={summary.bpm.title}
        ><Icon name="metronome" size={12} />{summary.bpm.text}</span
      >
    {/if}
    {#if summary.key}
      <span class="fact" title={summary.key.title}
        ><Icon name="key" size={12} />{summary.key.text}</span
      >
    {/if}
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if view.job}
    <StemJobCard job={view.job} {now} oncancel={cancel} onretry={split} />
  {/if}

  {#if set && !active}
    {#if view.sets.length > 1}
      <label class="picker">
        <span>Split</span>
        <select bind:value={selectedSet}>
          {#each view.sets as s (s.id)}
            <option value={s.id}>{new Date(s.createdAt).toLocaleString()} ({s.modelLabel})</option>
          {/each}
        </select>
      </label>
    {/if}
    {#key set.id}
      <StemSetPanel
        {trackId}
        {set}
        ondrag={(role: StemRole) => drag(set.id, role)}
        onreveal={(role: StemRole) => reveal(set.id, role)}
        onexport={() => exportSet(set.id)}
        onremove={() => remove(set.id)}
      />
    {/key}
  {/if}

  {#if !active && loaded}
    {#if !supported}
      <p class="notice">
        Stem splitting works on WAV tracks. This track is {format.toUpperCase()}.
      </p>
    {:else if providers.length > 0 && ready.length === 0}
      <p class="notice" role="status">The stem separator is starting. Try again in a moment.</p>
    {:else if ready.length === 0}
      <div class="empty">
        <p>
          <strong>Split this track into vocals, drums, bass, and other.</strong>
          {#if offered === false}
            Stem separators are in final testing and will appear in Plugins soon. This panel lights
            up as soon as one is installed.
          {:else}
            Install a stem separator from Plugins to get started. It runs locally; nothing is
            uploaded.
          {/if}
        </p>
        {#if offered !== false}
          <Button variant="primary" icon="plugin" onclick={() => nav.go('plugins')}>
            Browse separators
          </Button>
        {/if}
      </div>
    {:else}
      <div class="split" class:again={Boolean(set)}>
        {#if !set}
          <p>
            <strong>Split this track into separate instrument stems.</strong>
            Each stem gets its own waveform, solo and mute, and BPM or key measured on that part. The
            original track is never changed.
          </p>
        {/if}
        <div class="go">
          <select bind:value={chosen} aria-label="Stem separator">
            {#each ready as p (p.id)}
              <option value={p.id}>{p.label}: {p.stems.length} stems</option>
            {/each}
          </select>
          <Button variant="primary" icon="stems" onclick={split} disabled={busy || !chosen}>
            {set ? 'Split again' : 'Split stems'}
          </Button>
        </div>
        {#if !set}
          <p class="hint">
            {ready.find((p) => p.id === chosen)?.description ?? ''} Uses the GPU when available.
          </p>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  @import './stems-section.css';
</style>
