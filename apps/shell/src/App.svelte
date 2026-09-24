<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import Titlebar from './lib/Titlebar.svelte'
  import Nav from './lib/Nav.svelte'
  import Home from './lib/views/Home.svelte'
  import Generate from './lib/views/Generate.svelte'
  import Library from './lib/views/Library.svelte'
  import Styles from './lib/views/Styles.svelte'
  import Training from './lib/views/Training.svelte'
  import Plugins from './lib/views/Plugins.svelte'
  import Settings from './lib/views/Settings.svelte'
  import UpdateToast from './lib/UpdateToast.svelte'
  import PlayerHost from './lib/player/PlayerHost.svelte'
  import IconSprite from './lib/ui/IconSprite.svelte'
  import { nav, type View } from './lib/navigation.svelte'
  import { licensing } from './lib/licensing.svelte'

  let view = $state<View>('home')
  let availability = $state({ generate: false, training: false })
  // Route components own form drafts, fetched rows, selection, and subscription
  // state. Mount each view on first visit and hide it afterward so switching
  // tabs never throws that useful state away or repeats its initial load.
  let visited = $state<Set<View>>(new Set(['home']))

  function show(next: View): void {
    visited = new Set(visited).add(next)
    view = next
  }

  async function refreshAvailability(): Promise<void> {
    const [engine, training] = await Promise.all([
      window.iblis.engine.info(),
      window.iblis.training.packState()
    ])
    availability = {
      generate: engine.ok && engine.data.id !== null,
      training: training.ok && training.data.installed
    }
  }

  // Start the licensing subscription once, app-wide, so gates and the banner
  // react to revocation the instant main pushes a new state.
  $effect(() => {
    void licensing.initialize()
  })

  // Navigation is a prerequisite gate, while Plugins is always reachable for
  // installing those prerequisites. Refresh after any completed catalog job.
  $effect(() => {
    void refreshAvailability()
    return window.iblis.plugins.onInstallQueue((snapshot) => {
      if (snapshot.history[0]?.outcome === 'completed') void refreshAvailability()
    })
  })

  // Consume cross-tree navigation requests (e.g. a locked gate's link).
  $effect(() => {
    const target = nav.requested
    if (target !== null) {
      show(target)
      nav.clear()
    }
  })
</script>

<IconSprite />
<div class="app-shell">
  <Titlebar />
  <UpdateToast />
  <div class="app-main">
    <Nav {view} {availability} onNavigate={show} />
    <main class="app-body">
      {#if visited.has('home')}<section hidden={view !== 'home'}><Home /></section>{/if}
      {#if visited.has('generate')}<section hidden={view !== 'generate'}><Generate /></section>{/if}
      {#if visited.has('library')}
        <section hidden={view !== 'library'}><Library onremix={() => show('generate')} /></section>
      {/if}
      {#if visited.has('styles')}<section hidden={view !== 'styles'}><Styles /></section>{/if}
      {#if visited.has('training')}<section hidden={view !== 'training'}><Training /></section>{/if}
      {#if visited.has('plugins')}<section hidden={view !== 'plugins'}><Plugins /></section>{/if}
      {#if visited.has('settings')}<section hidden={view !== 'settings'}><Settings /></section>{/if}
    </main>
  </div>
  <PlayerHost />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .app-main {
    flex: 1 1 auto;
    display: flex;
    min-height: 0;
  }

  .app-body {
    flex: 1 1 auto;
    overflow: auto;
  }
</style>
