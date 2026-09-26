// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// State for one open "Write lyrics" or "Song idea" dialog: brief, provider and
// model choice, the confirm step, the in-flight request, and the editable
// preview. Every request goes through window.iblis.textAssist; nothing here
// touches the network or ever writes into the Create form by itself.
import type {
  AssistModelOption,
  AssistOptions,
  AssistProviderOption,
  AssistRequest,
  AssistTask,
  TextProviderId
} from '../../../shared/text-assist'
import type { LyricsStructure } from '../../../shared/assist-prompts'

export type AssistStep = 'brief' | 'confirm' | 'running' | 'preview'

export class AssistFlow {
  readonly task: AssistTask
  step = $state<AssistStep>('brief')
  options = $state<AssistOptions | null>(null)
  providerId = $state<TextProviderId | ''>('')
  modelId = $state('')
  topic = $state('')
  mood = $state('')
  language = $state('English')
  structure = $state<LyricsStructure>('standard')
  seed = $state('')
  preview = $state('')
  truncated = $state(false)
  error = $state<string | null>(null)
  // Each send gets a run number; Cancel marks the run it cancelled.
  private run = 0
  private cancelledRun = -1

  constructor(task: AssistTask) {
    this.task = task
  }

  get provider(): AssistProviderOption | null {
    return this.options?.providers.find((p) => p.id === this.providerId) ?? null
  }

  get model(): AssistModelOption | null {
    return this.provider?.models.find((m) => m.id === this.modelId) ?? null
  }

  get ready(): boolean {
    const briefOk = this.task === 'song-ideas' || this.topic.trim().length > 0
    return briefOk && !!this.provider?.available && !!this.model
  }

  get request(): AssistRequest | null {
    if (!this.providerId || !this.modelId) return null
    const base = { provider: this.providerId, model: this.modelId }
    return this.task === 'song-ideas'
      ? { ...base, task: 'song-ideas', brief: { seed: this.seed.trim() } }
      : {
          ...base,
          task: 'lyrics-assistance',
          brief: {
            topic: this.topic.trim(),
            mood: this.mood.trim(),
            language: this.language.trim(),
            structure: this.structure
          }
        }
  }

  async load(): Promise<void> {
    const result = await window.iblis.textAssist.options(this.task)
    if (!result.ok) {
      this.error = result.error
      return
    }
    this.options = result.data
    // Keep a still-usable choice; otherwise prefer the first available
    // provider, then its default model.
    if (!this.provider?.available) {
      const first = result.data.providers.find((p) => p.available) ?? result.data.providers[0]
      this.providerId = first?.id ?? ''
      this.modelId = ''
    }
    this.pickDefaultModel()
  }

  selectProvider(id: TextProviderId): void {
    this.providerId = id
    this.modelId = ''
    this.pickDefaultModel()
  }

  private pickDefaultModel(): void {
    const provider = this.provider
    if (!provider || provider.models.some((m) => m.id === this.modelId)) return
    this.modelId = provider.defaultModel ?? provider.models[0]?.id ?? ''
  }

  review(): void {
    if (!this.ready) return
    this.error = null
    this.step = 'confirm'
  }

  back(): void {
    this.error = null
    this.step = 'brief'
  }

  async send(): Promise<void> {
    const request = this.request
    if (!request || this.step === 'running') return
    this.error = null
    const run = ++this.run
    this.step = 'running'
    const result = await window.iblis.textAssist.generate(request)
    if (!result.ok) {
      this.error = result.error
      this.step = 'confirm'
    } else if (result.data.status === 'cancelled' || this.cancelledRun === run) {
      this.step = 'confirm'
    } else {
      this.preview = result.data.text
      this.truncated = result.data.truncated
      this.step = 'preview'
    }
  }

  async cancel(): Promise<void> {
    if (this.step !== 'running') return
    this.cancelledRun = this.run
    await window.iblis.textAssist.cancel(this.task)
  }
}
