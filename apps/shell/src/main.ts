// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import './lib/skins/skins.css'
import { applySkin, readSkin } from './lib/skins/skins'
import { applyOverrides } from './lib/skins/editor'
import {
  allInstalledSkinsCss,
  injectInstalledSkinsCss,
  installedSkinIds,
  readCachedInstalledSkins,
  syncInstalledSkins
} from './lib/skins/installed'

// Apply the persisted skin (and any per-skin token edits) before mounting so
// the window paints in the chosen palette immediately (no default-skin flash).
// CSP blocks an inline <head> script, so this is the earliest hook the
// renderer has. Installed skin plugins are re-injected from a localStorage
// cache of their (verified) descriptors so an installed skin paints with no
// flash too — exactly like the built-in skins.
const cached = readCachedInstalledSkins()
injectInstalledSkinsCss(allInstalledSkinsCss(cached))
const extra = installedSkinIds(cached)

const skin = readSkin(undefined, extra)
applySkin(skin, undefined, extra)
applyOverrides(skin)

const target = document.getElementById('app')
if (!target) throw new Error('renderer root #app not found')

const app = mount(App, { target })

// Refresh installed skins from the verified on-disk descriptors and re-apply
// the active skin — the cache may be stale (e.g. just after install/remove),
// in which case a persisted installed id now resolves correctly.
void syncInstalledSkins().then((skins) => {
  const ids = installedSkinIds(skins)
  const active = readSkin(undefined, ids)
  applySkin(active, undefined, ids)
  applyOverrides(active)
})

export default app
