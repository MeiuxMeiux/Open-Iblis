<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { IconName } from './icons'

  let { name, size = 18 }: { name: IconName; size?: number } = $props()
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  aria-hidden="true"
  focusable="false"
>
  <use href={`#i-${name}`}></use>
</svg>

<style>
  .icon {
    display: block;
    flex: none;
    overflow: visible;
    color: inherit;
  }
</style>
