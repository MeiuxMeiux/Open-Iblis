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

  async function load(): Promise<void> {
    const current = ++request
    detail = null
    error = null
    loading = true
    let result
    try {
      result = await window.iblis.library.detail(id)
    } catch (cause) {
      if (current !== request) return
      error = cause instanceof Error ? cause.message : String(cause)
      loading = false
      return
    }
    if (current !== request) return
    if (result.ok) detail = result.data
    else error = result.error
    loading = false
    if (
      result.ok &&
      result.data.processorJobs?.some((job) => ['queued', 'running'].includes(job.status))
    ) {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void load(), 1_000)
    }
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
    await load()
  }
</script>

<TrackDetailDrawer
  {detail}
  {loading}
  {error}
  {onclose}
  {onremix}
  onretry={(capability: ProcessorAnalysisCapability) => void retry(capability)}
  {retrying}
/>
