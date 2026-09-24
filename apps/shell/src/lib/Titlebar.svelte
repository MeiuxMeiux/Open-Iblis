<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Custom frameless titlebar. Window controls route through window.iblis,
  // demonstrating the contextBridge IPC path end to end.
  import Sigil from './Sigil.svelte'
  import Icon from './ui/Icon.svelte'

  let maximized = $state(false)

  $effect(() => {
    void window.iblis.window.isMaximized().then((r) => {
      if (r.ok) maximized = r.data.maximized
    })
    return window.iblis.window.onMaximizeChange((m) => (maximized = m))
  })

  const minimize = (): void => void window.iblis.window.minimize()
  const toggle = (): void => void window.iblis.window.toggleMaximize()
  const close = (): void => void window.iblis.window.close()
</script>

<header class="titlebar">
  <div class="brand">
    <span class="mark" aria-hidden="true"><Sigil size={15} /></span>
    <span class="name">Iblis</span>
  </div>

  <div class="drag"></div>

  <div class="controls">
    <button class="ctl" aria-label="Minimize" title="Minimize" onclick={minimize}>
      <Icon name="minimize" size={14} />
    </button>
    <button
      class="ctl"
      aria-label={maximized ? 'Restore' : 'Maximize'}
      title={maximized ? 'Restore' : 'Maximize'}
      onclick={toggle}
    >
      <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
    </button>
    <button class="ctl close" aria-label="Close" title="Close" onclick={close}>
      <Icon name="close" size={14} />
    </button>
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    height: var(--titlebar-h);
    flex: 0 0 var(--titlebar-h);
    background: var(--app-surface);
    border-bottom: 1px solid var(--color-border-default);
    /* Whole bar is draggable except interactive children. */
    -webkit-app-region: drag;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    font-size: 13px;
    letter-spacing: 0.04em;
  }
  .mark {
    color: var(--color-accent);
    font-size: 15px;
  }
  .name {
    color: var(--color-text-primary);
    opacity: 0.85;
  }

  .drag {
    flex: 1 1 auto;
    height: 100%;
  }

  .controls {
    display: flex;
    height: 100%;
    -webkit-app-region: no-drag;
  }
  .ctl {
    width: 46px;
    height: 100%;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    line-height: 1;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .ctl:hover {
    background: var(--app-surface-hover);
    color: var(--color-text-primary);
  }
  .ctl.close:hover {
    background: var(--color-state-danger);
    color: var(--color-text-inverse);
  }
</style>
