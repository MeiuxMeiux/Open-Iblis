# Boodark — Nord (skin plugin)

A `kind:"skin"` plugin: the cool [Nord](https://www.nordtheme.com/) palette,
delivered through the signed catalog rather than bundled into the shell. Proves
the skins-as-plugins path end to end (install → appears in the picker → applies
live → persists).

## What's here

- `skin.json` — the [`SkinDescriptor`](../../plugin-sdk/src/skin-contract.ts):
  `extends` a built-in base skin (`dark-3d`) and overrides the colour tokens.
  The shell reads + validates this on every launch and applies the tokens as a
  `:root[data-skin="…"]` block (no bundled CSS).
- `extras.css` — optional CSS loaded after the tokens. Tokens-only is the rule;
  this just adds a faint frost glow to prove the `css` path. No `@import`, no
  reaching internal class names.
- `manifest.source.json` — the plugin manifest source. `kind:"skin"`, no
  `executable` (skins never spawn a process), assets are `skin.json` + `extras.css`.

## Publishing

Publishing is a maintainer step (it needs the catalog signing key, and these
recipes exist only in the maintainers' repository). Add the entry to
`catalog.source.json`, then:

```bash
just catalog-build      # hashes/signs/verifies under .catalog-stage/
just catalog-publish    # uploads + verifies assets, then promotes the catalog
```

Publish changes the tracked live catalog only after both assets round-trip
verify; inspect it and run `just catalog-verify` before committing.
