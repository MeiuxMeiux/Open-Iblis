# Skins

A skin changes how Iblis looks, never what it does. Every color, font, radius,
shadow, spacing step, motion timing, and waveform color in the app comes from
a named design token. A skin sets values for those tokens, and every screen,
including plugin screens that did not exist when the skin was made, follows
them. That is the one rule the skin system depends on: no view hard-codes a
visual value.

## Built-in skins

| Id | Theme | Character |
| --- | --- | --- |
| `dark-3d` | dark | The default: restrained, with depth |
| `light-paper` | light | Quiet, paper-like |
| `infernal` | dark | Reds and black |
| `cathedral` | dark | Warm golds |

Pick one in Settings, Appearance. Installed skin plugins appear in the same
picker, tagged as plugins.

## Token vocabulary

The complete list is `SKIN_TOKENS` in
`packages/plugin-sdk/src/skin-contract.ts`. Each dotted token maps to a CSS
custom property by replacing dots with dashes (`tokenToCssVar`):
`color.bg.base` becomes `--color-bg-base`.

| Namespace | Tokens |
| --- | --- |
| `color.bg.*` | `base`, `elevated`, `subtle`, `inset` |
| `color.text.*` | `primary`, `secondary`, `muted`, `inverse` |
| `color.border.*` | `subtle`, `default`, `strong` |
| `color.accent` | The accent color |
| `color.state.*` | `danger`, `warning`, `success`, `info` |
| `radius.*` | `none`, `sm`, `md`, `lg`, `full` |
| `shadow.*` | `sm`, `md`, `lg` |
| `space.*` | `0`, `1`, `2`, `3`, `4`, `5`, `6`, `8`, `12` |
| `font.family.*` | `ui`, `mono`, `display` |
| `font.size.*` | `xs`, `sm`, `body`, `md`, `lg`, `xl`, `display` |
| `font.weight.*` | `regular`, `medium`, `semibold`, `bold` |
| `motion.*` | `duration-fast`, `duration-base`, `ease-standard` |
| `wave.*` | `fg`, `bg`, `peak`, `playhead` |

The list is closed. Unknown tokens are dropped when a skin is loaded or
imported, and a descriptor with no known token at all is rejected. Adding a
token is a change to the SDK
and to every built-in skin, made in one pull request.

## Skin descriptor

```json
{
  "id": "com.example.skin.midnight",
  "name": "Midnight",
  "version": "1.0.0",
  "extends": "dark-3d",
  "theme": "dark",
  "tokens": {
    "color.bg.base": "#101418",
    "color.bg.elevated": "#171c22",
    "color.text.primary": "#e6e9ef",
    "color.accent": "#7aa2f7",
    "radius.md": "8px"
  },
  "css": "extras.css"
}
```

- `extends` names the skin whose values fill in any token you leave out.
- `theme` tells the app whether the skin is dark or light.
- `tokens` holds only the values you change.
- `css` is optional: a stylesheet applied after the tokens.

`parseSkinDescriptor` in the SDK validates this shape.

## Skins as plugins

A skin plugin is a normal plugin of kind `skin` with no executable. Its
assets are `skin.json` (the descriptor above) and, optionally, the CSS file.
It installs, updates, and rolls back through the signed catalog like any other
plugin, and no process ever starts for it.

When the app launches, the main process reads each installed skin's
descriptor from its verified version folder, validates it, and passes it to
the renderer. The renderer turns the tokens into one
`:root[data-skin="<id>"] { ... }` block, appends the CSS, and applies it.
Installed skins then behave exactly like the built-ins, and a cached copy lets
the active skin paint without a flash at startup.

`packages/plugins/skin-boodark-nord/` is a complete example: a Nord palette
that extends `dark-3d`, with a small `extras.css`.

## Editing skins in the app

Settings, Appearance, Edit current skin opens a token editor:

- a live grid of every token, grouped by namespace, with search;
- reset per token, or reset all;
- **Export** saves a `.iblis-skin` file: a JSON descriptor with `extends` set
  to the base skin and your changed tokens;
- **Import** loads a `.iblis-skin` file. Known tokens apply on top of its base
  skin; unknown tokens are ignored. Imports are unsigned, and the app says so.

Your edits are stored per skin and survive restarts.

## Rules for skins

- Tokens first. Use `tokens` for values; use CSS only for effects tokens
  cannot express, and keep it short.
- Do not target internal class names. They are not stable and will change.
- No `@import`, no remote fonts or images, no JavaScript. A skin is values and
  CSS only.
- Do not change the meaning of controls. Icons come from the app's SVG sprite
  and inherit the token color of their control; a skin must not replace them.
- Keep text readable. Check contrast for `color.text.*` against
  `color.bg.*` in your skin, including muted text.

## Using tokens in code

UI code, in the shell or in a plugin, reads tokens through their CSS custom
properties:

```css
.panel {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
```

Never write a literal color, font, radius, shadow, or spacing value in a
component. If no token fits, propose a new one in an issue.
