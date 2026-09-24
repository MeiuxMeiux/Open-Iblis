<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { AppInfo, UpdateStatus } from '../../../shared/contract'
  import Icon from '../ui/Icon.svelte'

  let status = $state<UpdateStatus | null>(null)
  let info = $state<AppInfo | null>(null)
  // Source builds have no update feed (official-endpoints.ts); say so instead
  // of offering a check that cannot succeed.
  const sourceBuild = $derived(info !== null && !info.officialBuild)

  onMount(() => {
    void window.iblis.app.getInfo().then((result) => {
      if (result.ok) info = result.data
    })
    const unsubscribe = window.iblis.update.onStatus((next) => (status = next))
    void window.iblis.update.getStatus().then((result) => {
      if (result.ok) status = result.data
    })
    return unsubscribe
  })

  async function checkNow(): Promise<void> {
    const result = await window.iblis.update.checkNow()
    if (!result.ok) status = { state: 'error', error: result.error }
  }

  const restart = (): void => void window.iblis.update.install()
  const checking = $derived(status?.state === 'checking')
  const downloading = $derived(status?.state === 'downloading' || status?.state === 'available')
</script>

<section class="updates" aria-labelledby="updates-heading">
  <div>
    <h2 id="updates-heading">Updates</h2>
    {#if info}
      <p class="build" data-testid="build-kind">
        Version {info.version} · {info.officialBuild ? 'Official build' : 'Source build'}
      </p>
    {/if}
    <p class="hint">
      {sourceBuild
        ? 'This build was made from source and does not update itself. Rebuild it to update, or install an official build from the Iblis website.'
        : 'Iblis checks when it opens and while you are using it.'}
    </p>
  </div>
  {#if !sourceBuild}<div class="row">
      <div class="state" aria-live="polite">
        {#if status?.state === 'checking'}
          Checking for updates…
        {:else if status?.state === 'current'}
          Iblis is up to date.
        {:else if status?.state === 'available'}
          Update {status.version} found — downloading…
        {:else if status?.state === 'downloading'}
          Downloading update… {status.percent}%
        {:else if status?.state === 'ready'}
          Update {status.version} is ready to install.
        {:else if status?.state === 'error'}
          Could not check for an update. Try again when you are connected.
        {:else}
          Check for the latest signed Iblis release.
        {/if}
      </div>
      {#if status?.state === 'ready'}
        <button type="button" class="restart" onclick={restart}>
          <Icon name="refresh" size={15} />
          <span>Restart to update</span>
        </button>
      {:else}
        <button type="button" class="check" disabled={checking || downloading} onclick={checkNow}>
          <Icon name="refresh" size={15} />
          <span>{checking ? 'Checking…' : 'Check now'}</span>
        </button>
      {/if}
    </div>{/if}
</section>

<style>
  .updates {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .build {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--color-text-primary);
  }
  .hint,
  .state {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }
  .state {
    margin: 0;
  }
  .check,
  .restart {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    padding: 7px 12px;
    font-size: 13px;
  }
  .check {
    background: transparent;
    color: var(--color-accent);
  }
  .check:hover:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-text-inverse);
  }
  .check:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  .restart {
    background: var(--color-accent);
    color: var(--color-text-inverse);
  }
  @media (max-width: 560px) {
    .row {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
