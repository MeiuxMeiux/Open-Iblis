<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // The D2 consent screen: a dedicated step, not a checkbox row. Every
  // acknowledgement is explicit; main stamps the times into the job record.
  // A private training (D2 as amended by D-O2) never uploads, so it drops the
  // public-upload disclosure and keeps only the rights attestation.
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'

  let {
    publicUpload = $bindable(false),
    rights = $bindable(false),
    privateTraining = false
  }: { publicUpload?: boolean; rights?: boolean; privateTraining?: boolean } = $props()
</script>

<div class="consent">
  {#if privateTraining}
    <h3>Rights</h3>
    <p class="explain">
      This training stays on this machine. The finished style is added to your Styles and is not
      shared with anyone.
    </p>
  {:else}
    <h3>Sharing and rights</h3>
    <p class="explain">
      Training is a community feature. When a training finishes, the resulting style uploads to the
      Iblis community library and becomes publicly downloadable by other Iblis users under the name
      you chose. This is how Training works — it is not an option.
    </p>
    <ToggleSwitch
      bind:checked={publicUpload}
      label="I understand my finished training uploads publicly"
      description="The trained style file and its name, categories, and tags become public. Your songs and stems never upload — only the trained style."
    />
  {/if}
  <p class="explain">
    Training on music you do not hold rights to can violate the rights of its creators. You are
    responsible for what you train on.
  </p>
  <ToggleSwitch
    bind:checked={rights}
    label="I hold the rights to every song in this folder"
    description="Your own works, or material you are licensed to train on."
  />
</div>

<style>
  .consent {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .explain {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
</style>
