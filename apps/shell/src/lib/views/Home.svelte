<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { AppInfo, EngineInfo, UpdateStatus } from '../../../shared/contract'
  import Sigil from '../Sigil.svelte'
  import Icon from '../ui/Icon.svelte'

  let info = $state<AppInfo | null>(null)
  let engine = $state<EngineInfo | null>(null)
  let engineLoaded = $state(false)
  let engineCheckFailed = $state(false)
  let update = $state<UpdateStatus | null>(null)

  $effect(() => {
    void window.iblis.app.getInfo().then((r) => {
      if (r.ok) info = r.data
    })
  })

  $effect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick(): Promise<void> {
      try {
        const result = await window.iblis.engine.info()
        if (result.ok) {
          engine = result.data
          engineCheckFailed = false
        } else {
          engineCheckFailed = true
        }
      } catch {
        engineCheckFailed = true
      }
      engineLoaded = true

      if (
        !stopped &&
        (engineCheckFailed || !engine?.running || !engine.runtime || !!engine.runtimeError)
      ) {
        timer = setTimeout(() => void tick(), 2000)
      }
    }

    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  })

  $effect(() => window.iblis.update.onStatus((s) => (update = s)))

  const restart = (): void => void window.iblis.update.install()
</script>

<section class="empty">
  <div class="sigil" aria-hidden="true"><Sigil size={56} /></div>
  <div class="engine-status" aria-live="polite">
    {#if !engineLoaded}
      <h1>The shell is awake.</h1>
      <p class="lead">Checking your local workstation.</p>
      <p class="muted">Reading the installed engine and its live runtime capabilities.</p>
    {:else if engineCheckFailed}
      <h1>Engine status is unavailable.</h1>
      <p class="lead">The shell could not read the local engine state.</p>
      <p class="muted" role="alert">
        Reopen Iblis to try again. If the problem continues, check the engine from Plugins.
      </p>
    {:else if !engine?.id}
      <h1>The shell is awake.</h1>
      <p class="lead">Install the engine pack to get started.</p>
      <p class="muted">
        Open Plugins to install a signed local engine, then use Create to compose and render a
        track.
      </p>
    {:else if engine.runtimeError}
      <h1>The engine needs attention.</h1>
      <p class="lead">The engine is installed, but its runtime profile could not be verified.</p>
      <p class="muted" role="alert">{engine.runtimeError}</p>
    {:else if engine.running && engine.runtime}
      <h1>Ready to create.</h1>
      <p class="lead">Your local engine is running.</p>
      <p class="muted">
        Open Create to compose a track, compare recipes, and keep the result in your local library.
      </p>
    {:else}
      <h1>The engine is starting.</h1>
      <p class="lead">Your installed engine is preparing its local models.</p>
      <p class="muted">
        This can take a moment on first launch. Iblis will update when it is ready.
      </p>
    {/if}
  </div>

  {#if update && update.state !== 'current'}
    <div class="update" class:ready={update.state === 'ready'}>
      {#if update.state === 'checking'}
        Checking for updates…
      {:else if update.state === 'available'}
        Update {update.version} found — downloading…
      {:else if update.state === 'downloading'}
        Downloading update… {update.percent}%
      {:else if update.state === 'ready'}
        <span>Update {update.version} ready.</span>
        <button class="restart" onclick={restart}>
          <Icon name="refresh" size={15} />
          <span>Restart to update</span>
        </button>
      {:else if update.state === 'error'}
        Update check failed.
      {/if}
    </div>
  {/if}

  {#if info}
    <footer class="build">Iblis {info.version}</footer>
  {/if}
</section>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0 32px;
    text-align: center;
  }

  .sigil {
    font-size: 56px;
    color: var(--color-accent);
    opacity: 0.55;
    margin-bottom: 18px;
  }

  .engine-status {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .lead {
    margin: 10px 0 0;
    font-size: 16px;
    color: var(--color-text-primary);
  }

  .muted {
    max-width: 460px;
    margin: 14px 0 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }

  .update {
    margin-top: 26px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .update.ready {
    color: var(--color-text-primary);
  }
  .restart {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--color-accent);
    background: transparent;
    color: var(--color-accent);
    padding: 6px 14px;
    border-radius: var(--radius-lg);
    font-size: 13px;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .restart:hover {
    background: var(--color-accent);
    color: var(--color-text-inverse);
  }

  .build {
    margin-top: 30px;
    font-size: 11.5px;
    letter-spacing: 0.05em;
    color: var(--color-text-secondary);
  }
</style>
