<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { AdapterImportDetails, ImportedAdapterFormat } from '../../../shared/adapters'
  import Button from '../ui/Button.svelte'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'
  import StyleDisclosureDialog from './StyleDisclosureDialog.svelte'

  let { onLibraryChanged }: { onLibraryChanged?: () => void } = $props()

  const emptyDetails: AdapterImportDetails = {
    displayName: '',
    sourceUrl: '',
    claimedLicense: '',
    terms: '',
    claimedBaseModel: ''
  }
  let details = $state<AdapterImportDetails>({ ...emptyDetails })
  let riskAcknowledged = $state(false)
  let open = $state(false)
  let busy = $state(false)
  let error = $state('')
  let pending = $state<{ format: ImportedAdapterFormat; details: AdapterImportDetails } | null>(
    null
  )

  function requestImport(format: ImportedAdapterFormat): void {
    if (!details.displayName.trim()) {
      return void (error = 'Name this style before choosing its file.')
    }
    if (!riskAcknowledged) {
      return void (error = 'Acknowledge the local-style risks before choosing its file.')
    }
    error = ''
    pending = { format, details: { ...details } }
  }

  async function confirmDisclosure(): Promise<void> {
    const selection = pending
    if (!selection) return
    pending = null
    error = ''
    busy = true
    const result = await window.iblis.adapters.importFromDialog(
      selection.format,
      selection.details,
      true
    )
    busy = false
    if (!result.ok) return void (error = result.error)
    if (result.data) {
      details = { ...emptyDetails }
      riskAcknowledged = false
      open = false
      onLibraryChanged?.()
    }
  }
</script>

<section class="style-section local" aria-labelledby="local-style-heading">
  <header>
    <div>
      <h2 id="local-style-heading">Import a local style</h2>
      <p>Bring in a Safetensors file or a documented PEFT folder you already have.</p>
    </div>
    <Button
      icon={open ? 'chevron-up' : 'chevron-down'}
      title={open ? 'Close import' : 'Add local style'}
      onclick={() => (open = !open)}
    >
      {open ? 'Close import' : 'Add local style'}
    </Button>
  </header>
  {#if open}
    <div class="local-form">
      <p>
        Record the source and publisher claims you know. Iblis keeps this information with the
        managed local copy.
      </p>
      <label>
        <span>Style name</span>
        <input
          bind:value={details.displayName}
          maxlength="512"
          placeholder="e.g. My midnight synth sound"
        />
      </label>
      <div class="local-details">
        <label>
          <span>Source link <em>optional</em></span>
          <input bind:value={details.sourceUrl} maxlength="16384" type="url" />
        </label>
        <label>
          <span>Publisher license or terms <em>optional</em></span>
          <input bind:value={details.claimedLicense} maxlength="16384" />
        </label>
        <label>
          <span>Base-model claim <em>optional</em></span>
          <input bind:value={details.claimedBaseModel} maxlength="16384" />
        </label>
      </div>
      <label>
        <span>Additional terms <em>optional</em></span>
        <textarea bind:value={details.terms} maxlength="16384"></textarea>
      </label>
      <ToggleSwitch
        bind:checked={riskAcknowledged}
        label="I understand the risks"
        description="I have the right to import this local style and understand it is not enabled for generation."
      />
      <div class="local-actions">
        <Button
          variant="primary"
          icon="folder"
          disabled={busy || !riskAcknowledged}
          onclick={() => requestImport('safetensors')}
        >
          Choose file
        </Button>
        <Button
          icon="folder"
          disabled={busy || !riskAcknowledged}
          onclick={() => requestImport('peft')}
        >
          Choose PEFT folder
        </Button>
      </div>
    </div>
  {/if}
  {#if error}<p class="error form-error" role="alert">{error}</p>{/if}
  {#if pending}
    <StyleDisclosureDialog
      details={pending.details}
      actionLabel="Choose style file"
      onConfirm={() => void confirmDisclosure()}
      onClose={() => (pending = null)}
    />
  {/if}
</section>

<style>
  .local {
    display: block;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    box-shadow: var(--shadow-md);
  }
  .local > header {
    padding: var(--space-4);
  }
  .local header p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.45;
  }
  .local-form {
    display: grid;
    gap: var(--space-4);
    border-top: 1px solid var(--color-border-default);
    padding: var(--space-4);
  }
  .local-form > p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.45;
  }
  label {
    display: grid;
    gap: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  label em {
    color: var(--color-text-muted);
    font-style: normal;
  }
  input,
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 40px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
    padding: 9px var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  textarea {
    min-height: 76px;
    resize: vertical;
  }
  .local-details {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .local-details label:last-child {
    grid-column: 1 / -1;
  }
  .local-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .form-error {
    margin: 0 var(--space-4) var(--space-4);
  }
  @media (max-width: 620px) {
    .local > header {
      align-items: flex-start;
      flex-direction: column;
    }
    .local-details {
      grid-template-columns: 1fr;
    }
    .local-details label:last-child {
      grid-column: auto;
    }
  }
</style>
