<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings -> Product Key. Enter/renew/remove the key that connects the app
  // to hosted services (community Styles, uploads). Iblis itself is free and
  // open source: generation, training, the library, and skins never need a
  // key (D-O2). See docs/admin/03-shell-integration.md.
  import type { LicensingState } from '../../../shared/licensing'
  import { nav } from '../navigation.svelte'

  let lic = $state<LicensingState | null>(null)
  let keyInput = $state('')
  let busy = $state(false)

  // When a locked gate deep-links here ("Enter a product key"), land the user
  // on this panel with the field focused rather than at the top of Settings.
  let sectionEl = $state<HTMLElement | null>(null)
  let inputEl = $state<HTMLInputElement | null>(null)
  let pendingFocus = $state(false)
  let scrolled = false

  // Consume the anchor reactively, not just on mount: Settings stays mounted
  // across tab switches, so a deep-link can arrive while this panel already
  // exists. Each arrival re-arms the scroll+focus pass.
  $effect(() => {
    if (nav.peekAnchor('product-key') && nav.consumeAnchor('product-key')) {
      pendingFocus = true
      scrolled = false
    }
  })

  $effect(() => {
    if (!pendingFocus) return
    if (sectionEl !== null && !scrolled) {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrolled = true
    }
    // The input only exists when there is a key to enter (keyless or ended).
    // Focus it once it renders; for states without a field, scrolling is enough.
    if (inputEl !== null) {
      inputEl.focus()
      pendingFocus = false
    } else if (lic !== null && lic.status !== 'keyless' && lic.status !== 'ended') {
      pendingFocus = false
    }
  })

  $effect(() => {
    void window.iblis.licensing.state().then((r) => {
      if (r.ok) lic = r.data
    })
    return window.iblis.licensing.onState((s) => {
      lic = s
    })
  })

  // Every terminal server code maps to specific, honest copy (03 doc §GUI).
  const ERROR_COPY: Record<string, string> = {
    unknown_key:
      'That key is not recognized. Check for typos - the form is IBLIS-XXXX-XXXX-XXXX-XXXX.',
    expired: 'This key has expired. Enter a new key to reconnect hosted services.',
    revoked: 'This key was revoked. If you think that is a mistake, get in touch.',
    activation_cap:
      'This key is already active on its maximum number of devices. Remove it from one of them (Settings on that device) and try again.',
    flagged:
      'This key is paused for review. Devices already using it keep working; new activations wait for a human.',
    not_yet_activatable: 'This key sat unused past its activate-by date and has lapsed.',
    rate_limited: 'Too many attempts. Wait a minute and try again.',
    stale_lease: 'The stored entitlement went stale. Revalidating usually fixes this.',
    key_unreadable:
      'The stored key could not be read back from this machine. Remove the key and enter it again.',
    offline: 'Iblis could not reach the licensing server. Check your connection and try again.',
    'not-configured':
      'This build is not connected to the Iblis licensing service. Official installers from the Iblis website include it.'
  }

  function errorCopy(code: string | null): string | null {
    if (code === null) return null
    return ERROR_COPY[code] ?? `The licensing server said: ${code}.`
  }

  function fmtDate(iso: string | null): string {
    if (iso === null) return '-'
    const t = Date.parse(iso)
    return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString()
  }

  async function activate(): Promise<void> {
    if (keyInput.trim() === '') return
    busy = true
    const r = await window.iblis.licensing.activate(keyInput)
    busy = false
    if (r.ok) {
      lic = r.data
      if (r.data.status === 'licensed') keyInput = ''
    }
  }

  async function refresh(): Promise<void> {
    busy = true
    const r = await window.iblis.licensing.refresh()
    busy = false
    if (r.ok) lic = r.data
  }

  async function remove(): Promise<void> {
    busy = true
    const r = await window.iblis.licensing.deactivate()
    busy = false
    if (r.ok) lic = r.data
  }
</script>

<section class="group" bind:this={sectionEl}>
  <h2>Product key</h2>

  {#if lic === null}
    <p class="hint">Loading…</p>
  {:else if lic.status === 'keyless'}
    <p class="hint">
      Iblis is free and open source. Generation, training, your library, and skins never need a key.
      A product key connects the app to hosted services: community Styles publishing and downloads,
      and uploads.
    </p>
    <div class="row">
      <input
        class="key"
        placeholder="IBLIS-XXXX-XXXX-XXXX-XXXX"
        bind:value={keyInput}
        bind:this={inputEl}
        spellcheck="false"
        autocomplete="off"
      />
      <button class="go" disabled={busy || keyInput.trim() === ''} onclick={activate}>
        {busy ? 'Activating…' : 'Activate'}
      </button>
    </div>
    {#if errorCopy(lic.lastError)}
      <p class="problem">{errorCopy(lic.lastError)}</p>
    {/if}
  {:else}
    <div class="facts">
      <div><span class="k">Key</span><span class="mono">{lic.maskedKey ?? '-'}</span></div>
      <div><span class="k">Expires</span><span>{fmtDate(lic.keyExpiresAt)}</span></div>
      <div><span class="k">Revalidates by</span><span>{fmtDate(lic.leaseExpiresAt)}</span></div>
    </div>

    {#if lic.status === 'stale'}
      <p class="problem">
        Iblis could not revalidate this key since {fmtDate(lic.leaseExpiresAt)}. It revalidates
        automatically when you are back online, or try now.
      </p>
    {:else if lic.status === 'ended'}
      <p class="problem">{errorCopy(lic.reason) ?? 'This key is no longer active.'}</p>
    {:else if errorCopy(lic.lastError)}
      <p class="problem quiet">{errorCopy(lic.lastError)}</p>
    {/if}

    {#if lic.status === 'ended'}
      <p class="hint">
        Generation, training, and your library keep working. Enter a new product key to reconnect
        hosted services.
      </p>
      <div class="row">
        <input
          class="key"
          placeholder="IBLIS-XXXX-XXXX-XXXX-XXXX"
          bind:value={keyInput}
          bind:this={inputEl}
          spellcheck="false"
          autocomplete="off"
        />
        <button class="go" disabled={busy || keyInput.trim() === ''} onclick={activate}>
          {busy ? 'Activating…' : 'Activate new key'}
        </button>
      </div>
    {/if}

    <div class="row">
      {#if lic.status !== 'ended'}
        <button class="go" disabled={busy} onclick={refresh}>
          {busy ? 'Checking…' : 'Revalidate now'}
        </button>
      {/if}
      <button class="danger" disabled={busy} onclick={remove}>Remove key from this device</button>
    </div>
  {/if}
</section>

<style>
  .group h2 {
    margin: 0 0 var(--space-2);
  }
  .hint {
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-3);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }
  input.key {
    flex: 1;
    min-width: 240px;
    max-width: 340px;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.06em;
    padding: var(--space-2);
    background: var(--app-surface);
    color: inherit;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  button {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-default);
    background: var(--app-surface);
    color: inherit;
    cursor: pointer;
  }
  button.go {
    background: var(--color-accent);
    border-color: transparent;
    font-weight: var(--font-weight-semibold);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .facts {
    display: grid;
    gap: var(--space-1);
    margin: 0 0 var(--space-3);
  }
  .facts > div {
    display: flex;
    gap: var(--space-2);
  }
  .facts .k {
    color: var(--color-text-secondary);
    min-width: 9em;
  }
  .mono {
    font-family: var(--font-mono, monospace);
  }
  .problem {
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-3);
    margin: var(--space-2) 0;
  }
  .problem.quiet {
    border-style: dashed;
  }
</style>
