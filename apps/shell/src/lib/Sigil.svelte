<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // The Iblis mark: an inverted pentacle (downward-point pentagram inscribed in
  // a circle), drawn inline with `currentColor` so it inherits the active
  // skin's accent and renders identically on every platform (no font glyph
  // dependency). Replaces the old peace-symbol character. Swap this SVG when
  // real brand art lands.
  let { size = 24 }: { size?: number } = $props()
</script>

<svg
  class="sigil-svg"
  width={size}
  height={size}
  viewBox="0 0 100 100"
  fill="none"
  stroke="currentColor"
  stroke-width="4"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <circle cx="50" cy="50" r="46" />
  <path d="M50 96 L22.95 12.79 L93.75 64.21 L6.25 64.21 L77.05 12.79 Z" />
</svg>

<style>
  .sigil-svg {
    display: block;
  }
</style>
