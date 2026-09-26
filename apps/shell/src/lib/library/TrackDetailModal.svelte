<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
  import type { TrackDetail } from '../../../shared/generation-record'
  import TrackDetailDrawer from './TrackDetailDrawer.svelte'

  let {
    id,
    onclose,
    onremix
  }: {
    id: string
    onclose: () => void
    onremix: () => void
  } = $props()

  let detail = $state<TrackDetail | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let retrying = $state<ProcessorAnalysisCapability | null>(null)
  let request = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  onMount(() => {
    void load()
    return () => {
      request++
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  })

  // A refresh keeps the drawer mounted: resetting `detail` would remount every
  // section (and stop stem playback) on each poll.
  async function load(refresh = false): Promise<void> {
    const current = ++request
    if (!refresh) {
      detail = null
      loading = true
    }
    error = null
    let result
    try {
      result = await window.iblis.library.detail(id)
    } catch (cause) {
      if (current !== request) return
      // A failed background refresh keeps the last good view on screen.
      if (!refresh || !detail) error = cause instanceof Error ? cause.message : String(cause)
      loading = false
      return
    }
    if (current !== request) return
    if (result.ok) detail = result.data
    else if (!refresh || !detail) error = result.error
    loading = false
    if (
      result.ok &&
      result.data.processorJobs?.some((job) => ['queued', 'running'].includes(job.status))
    ) {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void load(true), 1_000)
    }
  }

  // Manual analysis for a track with no detection yet (made before the
  // detectors shipped, or while detection was off). Consent is the click.
  async function analyze(): Promise<void> {
    const result = await window.iblis.processors.analyze(id).catch((cause: unknown) => ({
      ok: false as const,
      error: cause instanceof Error ? cause.message : String(cause)
    }))
    if (!result.ok) error = result.error
    await load(true)
  }

  async function retry(capability: ProcessorAnalysisCapability): Promise<void> {
    if (retrying) return
    retrying = capability
    const result = await window.iblis.processors.retry(id, capability).catch((cause: unknown) => ({
      ok: false as const,
      error: cause instanceof Error ? cause.message : String(cause)
    }))
    if (!result.ok) error = result.error
    retrying = null
    await load(true)
  }
</script>

<TrackDetailDrawer
  {detail}
  {loading}
  {error}
  {onclose}
  {onremix}
  onretry={(capability: ProcessorAnalysisCapability) => void retry(capability)}
  onanalyze={() => void analyze()}
  {retrying}
/>
