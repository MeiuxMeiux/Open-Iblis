// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IblisApi, InstallProgress, QueueSnapshot, UpdateStatus } from '../../shared/contract'
import type { PluginInstallQueueSnapshot } from '../../shared/plugin-install-queue'

// The ONLY bridge between renderer and main. No node, no fetch in the
// renderer — everything goes through these typed channels.
const api: IblisApi = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo')
  },
  storage: {
    location: () => ipcRenderer.invoke('storage:location'),
    chooseLocation: () => ipcRenderer.invoke('storage:choose-location'),
    restartToApply: () => ipcRenderer.invoke('storage:restart-to-apply')
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximizeChange: (cb) => {
      const listener = (_e: IpcRendererEvent, maximized: boolean): void => cb(maximized)
      ipcRenderer.on('window:maximize-change', listener)
      return () => ipcRenderer.removeListener('window:maximize-change', listener)
    }
  },
  update: {
    getStatus: () => ipcRenderer.invoke('update:get-status'),
    onStatus: (cb) => {
      const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.removeListener('update:status', listener)
    },
    checkNow: () => ipcRenderer.invoke('update:check-now'),
    install: () => ipcRenderer.invoke('update:install')
  },
  catalog: {
    list: () => ipcRenderer.invoke('catalog:list')
  },
  plugins: {
    listInstalled: () => ipcRenderer.invoke('plugins:list'),
    install: (id, version) => ipcRenderer.invoke('plugins:install', id, version),
    onInstallProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: InstallProgress): void => cb(p)
      ipcRenderer.on('plugins:install-progress', listener)
      return () => ipcRenderer.removeListener('plugins:install-progress', listener)
    },
    installQueue: () => ipcRenderer.invoke('plugins:install-queue'),
    onInstallQueue: (cb) => {
      const listener = (_e: IpcRendererEvent, snapshot: PluginInstallQueueSnapshot): void =>
        cb(snapshot)
      ipcRenderer.on('plugins:install-queue', listener)
      return () => ipcRenderer.removeListener('plugins:install-queue', listener)
    },
    cancelInstall: (id) => ipcRenderer.invoke('plugins:cancel-install', id),
    rollback: (id) => ipcRenderer.invoke('plugins:rollback', id),
    remove: (id) => ipcRenderer.invoke('plugins:remove', id),
    health: () => ipcRenderer.invoke('plugins:health')
  },
  adapters: {
    list: () => ipcRenderer.invoke('adapters:list'),
    importFromDialog: (format, details, acknowledged) =>
      ipcRenderer.invoke('adapters:import-from-dialog', format, details, acknowledged),
    remove: (id) => ipcRenderer.invoke('adapters:remove', id),
    reveal: (id) => ipcRenderer.invoke('adapters:reveal', id),
    offers: () => ipcRenderer.invoke('adapters:offers'),
    installOffer: (id, acknowledged) =>
      ipcRenderer.invoke('adapters:install-offer', id, acknowledged),
    onInstallProgress: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        progress: import('../../shared/adapters').AdapterInstallProgress
      ): void => cb(progress)
      ipcRenderer.on('adapters:install-progress', listener)
      return () => ipcRenderer.removeListener('adapters:install-progress', listener)
    },
    runCompatibilityProof: (id) => ipcRenderer.invoke('adapters:run-compatibility-proof', id),
    onCompatibilityProofProgress: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        progress: import('../../shared/adapters').AdapterProofProgress
      ): void => cb(progress)
      ipcRenderer.on('adapters:compatibility-proof-progress', listener)
      return () => ipcRenderer.removeListener('adapters:compatibility-proof-progress', listener)
    },
    revealCompatibilityProof: (proofId) =>
      ipcRenderer.invoke('adapters:reveal-compatibility-proof', proofId)
  },
  skins: {
    list: () => ipcRenderer.invoke('skins:list')
  },
  engine: {
    info: () => ipcRenderer.invoke('engine:info'),
    list: () => ipcRenderer.invoke('engine:list'),
    select: (pluginId: string) => ipcRenderer.invoke('engine:select', pluginId)
  },
  queue: {
    snapshot: () => ipcRenderer.invoke('queue:snapshot'),
    enqueue: (request) => ipcRenderer.invoke('queue:enqueue', request),
    compare: (request, variant) => ipcRenderer.invoke('queue:compare', request, variant),
    edit: (id, request) => ipcRenderer.invoke('queue:edit', id, request),
    move: (id, toIndex) => ipcRenderer.invoke('queue:move', id, toIndex),
    duplicate: (id) => ipcRenderer.invoke('queue:duplicate', id),
    remove: (id) => ipcRenderer.invoke('queue:remove', id),
    pause: () => ipcRenderer.invoke('queue:pause'),
    resume: () => ipcRenderer.invoke('queue:resume'),
    cancel: () => ipcRenderer.invoke('queue:cancel'),
    clear: () => ipcRenderer.invoke('queue:clear'),
    reveal: (groupId) => ipcRenderer.invoke('queue:reveal', groupId),
    discardComparison: (groupId) => ipcRenderer.invoke('queue:discard-comparison', groupId),
    onSnapshot: (cb) => {
      const listener = (_e: IpcRendererEvent, snapshot: QueueSnapshot): void => cb(snapshot)
      ipcRenderer.on('queue:snapshot', listener)
      return () => ipcRenderer.removeListener('queue:snapshot', listener)
    }
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    detail: (id, includeAnalysis) => ipcRenderer.invoke('library:detail', id, includeAnalysis),
    rename: (id, name) => ipcRenderer.invoke('library:rename', id, name),
    rate: (id, rating) => ipcRenderer.invoke('library:rate', id, rating),
    folders: () => ipcRenderer.invoke('library:folders'),
    folderCreate: (name) => ipcRenderer.invoke('library:folder-create', name),
    folderRename: (id, name) => ipcRenderer.invoke('library:folder-rename', id, name),
    folderRemove: (id) => ipcRenderer.invoke('library:folder-remove', id),
    moveToFolder: (id, folderId) => ipcRenderer.invoke('library:move-to-folder', id, folderId),
    remove: (id) => ipcRenderer.invoke('library:remove', id),
    reveal: (id) => ipcRenderer.invoke('library:reveal', id),
    dragOut: (id) => ipcRenderer.invoke('library:dragOut', id),
    prompts: () => ipcRenderer.invoke('library:prompts'),
    promptStar: (id, starred) => ipcRenderer.invoke('library:prompt-star', id, starred),
    promptRemove: (id) => ipcRenderer.invoke('library:prompt-remove', id),
    promptsClear: () => ipcRenderer.invoke('library:prompts-clear'),
    analysis: (id) => ipcRenderer.invoke('library:analysis', id),
    mediaObserved: (id, observation) =>
      ipcRenderer.invoke('library:media-observed', id, observation)
  },
  processors: {
    settings: () => ipcRenderer.invoke('processors:settings'),
    detail: (id) => ipcRenderer.invoke('processors:detail', id),
    acknowledge: (id) => ipcRenderer.invoke('processors:acknowledge', id),
    setDefault: (capability, pluginId) =>
      ipcRenderer.invoke('processors:set-default', capability, pluginId),
    results: (trackId) => ipcRenderer.invoke('processors:results', trackId),
    benchmarks: () => ipcRenderer.invoke('processors:benchmarks'),
    benchmark: (trackId, providerIds) =>
      ipcRenderer.invoke('processors:benchmark', trackId, providerIds),
    exportBenchmark: (id) => ipcRenderer.invoke('processors:export-benchmark', id),
    retry: (trackId, capability) => ipcRenderer.invoke('processors:retry', trackId, capability)
  },
  cloudProviders: {
    snapshot: () => ipcRenderer.invoke('cloud-providers:snapshot'),
    saveKey: (provider, key) => ipcRenderer.invoke('cloud-providers:save-key', provider, key),
    removeKey: (provider) => ipcRenderer.invoke('cloud-providers:remove-key', provider),
    test: (provider) => ipcRenderer.invoke('cloud-providers:test', provider),
    refreshModels: (provider) => ipcRenderer.invoke('cloud-providers:refresh-models', provider),
    setEnabled: (provider, enabled) =>
      ipcRenderer.invoke('cloud-providers:set-enabled', provider, enabled),
    acknowledgeConsent: (provider) =>
      ipcRenderer.invoke('cloud-providers:acknowledge-consent', provider),
    setTask: (provider, task, enabled) =>
      ipcRenderer.invoke('cloud-providers:set-task', provider, task, enabled),
    setDefault: (task, modelId) => ipcRenderer.invoke('cloud-providers:set-default', task, modelId)
  },
  feedback: {
    lastDiagRef: () => ipcRenderer.invoke('feedback:last-diag-ref'),
    open: (kind, attachDiag) => ipcRenderer.invoke('feedback:open', kind, attachDiag)
  },
  diag: {
    getLevel: () => ipcRenderer.invoke('diag:getLevel'),
    setLevel: (level) => ipcRenderer.invoke('diag:setLevel', level),
    send: (note) => ipcRenderer.invoke('diag:send', note)
  },
  perf: {
    info: () => ipcRenderer.invoke('perf:info'),
    set: (settings) => ipcRenderer.invoke('perf:set', settings),
    restartEngine: () => ipcRenderer.invoke('perf:restartEngine')
  },
  engineActions: {
    probe: () => ipcRenderer.invoke('engine:actions-probe'),
    evidence: () => ipcRenderer.invoke('engine:actions-evidence')
  },
  resource: {
    state: () => ipcRenderer.invoke('resource:state'),
    onState: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        state: import('../../shared/training').ResourceState
      ): void => cb(state)
      ipcRenderer.on('resource:state', listener)
      return () => ipcRenderer.removeListener('resource:state', listener)
    }
  },
  training: {
    packState: () => ipcRenderer.invoke('training:packState'),
    preflight: () => ipcRenderer.invoke('training:preflight'),
    scanFolder: () => ipcRenderer.invoke('training:scanFolder'),
    visibility: () => ipcRenderer.invoke('training:visibility'),
    reserveName: (name, categories) => ipcRenderer.invoke('training:reserveName', name, categories),
    start: (input) => ipcRenderer.invoke('training:start', input),
    list: () => ipcRenderer.invoke('training:list'),
    cancel: (jobId) => ipcRenderer.invoke('training:cancel', jobId),
    resume: (jobId) => ipcRenderer.invoke('training:resume', jobId),
    deleteJob: (jobId) => ipcRenderer.invoke('training:deleteJob', jobId),
    retryUpload: (jobId) => ipcRenderer.invoke('training:retryUpload', jobId),
    onProgress: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        event: import('../../shared/training').TrainingProgressEvent
      ): void => cb(event)
      ipcRenderer.on('training:progress', listener)
      return () => ipcRenderer.removeListener('training:progress', listener)
    },
    onJobs: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        jobs: import('../../shared/training').TrainingJobView[]
      ): void => cb(jobs)
      ipcRenderer.on('training:jobs', listener)
      return () => ipcRenderer.removeListener('training:jobs', listener)
    }
  },
  styles: {
    index: (force) => ipcRenderer.invoke('styles:index', force),
    download: (id) => ipcRenderer.invoke('styles:download', id),
    remove: (adapterId) => ipcRenderer.invoke('styles:remove', adapterId),
    onDownloadProgress: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        progress: import('../../shared/styles').StylesDownloadProgress
      ): void => cb(progress)
      ipcRenderer.on('styles:download-progress', listener)
      return () => ipcRenderer.removeListener('styles:download-progress', listener)
    }
  },
  licensing: {
    state: () => ipcRenderer.invoke('licensing:state'),
    activate: (key) => ipcRenderer.invoke('licensing:activate', key),
    deactivate: () => ipcRenderer.invoke('licensing:deactivate'),
    refresh: () => ipcRenderer.invoke('licensing:refresh'),
    onState: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        state: import('../../shared/licensing').LicensingState
      ): void => cb(state)
      ipcRenderer.on('licensing:state', listener)
      return () => ipcRenderer.removeListener('licensing:state', listener)
    }
  }
}

contextBridge.exposeInMainWorld('iblis', api)
