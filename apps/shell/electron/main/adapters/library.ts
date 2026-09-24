// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  ADAPTER_LIBRARY_VERSION,
  MAX_ADAPTER_BYTES,
  MAX_ADAPTER_CONFIG_BYTES,
  type AdapterImportDisclosure,
  type AdapterLibraryDocument,
  type ImportedAdapterFile,
  type ImportedAdapterFormat,
  type ImportedAdapterRecord
} from './types'
import { safetensorsProblem } from './safetensors'
import { heavyDataRoot } from '../storage'
import { ignoreFailure } from '../ignore-failure'

const MAX_TEXT_BYTES = 16 * 1024
const SHA256 = /^[a-f0-9]{64}$/

export function adaptersRoot(): string {
  // An empty override counts as unset.
  const override = process.env.IBLIS_ADAPTERS_DIR
  if (override) return override
  return join(heavyDataRoot(), 'adapters')
}

function text(value: string | undefined, label: string): string | undefined {
  const cleaned = value?.trim()
  if (!cleaned) return undefined
  if (Buffer.byteLength(cleaned, 'utf8') > MAX_TEXT_BYTES) throw new Error(`${label} is too large`)
  return cleaned
}

function requiredText(value: string | undefined, label: string): string {
  const cleaned = text(value, label)
  if (!cleaned) throw new Error(`${label} is required`)
  return cleaned
}

function disclosure(input: AdapterImportDisclosure): AdapterImportDisclosure {
  if (!Number.isSafeInteger(input.acknowledgedAt) || input.acknowledgedAt <= 0) {
    throw new Error('adapter warning must be acknowledged')
  }
  return {
    displayName: requiredText(input.displayName, 'adapter name'),
    ...(text(input.sourceOfferId, 'source offer ID')
      ? { sourceOfferId: text(input.sourceOfferId, 'source offer ID') }
      : {}),
    ...(text(input.sourceUrl, 'source URL')
      ? { sourceUrl: text(input.sourceUrl, 'source URL') }
      : {}),
    ...(text(input.sourceRevision, 'source revision')
      ? { sourceRevision: text(input.sourceRevision, 'source revision') }
      : {}),
    ...(text(input.claimedLicense, 'claimed license')
      ? { claimedLicense: text(input.claimedLicense, 'claimed license') }
      : {}),
    ...(text(input.terms, 'adapter terms') ? { terms: text(input.terms, 'adapter terms') } : {}),
    ...(text(input.claimedBaseModel, 'claimed base model')
      ? { claimedBaseModel: text(input.claimedBaseModel, 'claimed base model') }
      : {}),
    ...(input.origin !== undefined
      ? {
          origin: (['imported', 'downloaded', 'yours'] as const).find((o) => o === input.origin)
        }
      : {}),
    ...(text(input.trainingId, 'training id')
      ? { trainingId: text(input.trainingId, 'training id') }
      : {}),
    ...(input.visibility === 'private' || input.visibility === 'community'
      ? { visibility: input.visibility }
      : {}),
    ...(typeof input.trainingVersion === 'number' &&
    Number.isSafeInteger(input.trainingVersion) &&
    input.trainingVersion > 0
      ? { trainingVersion: input.trainingVersion }
      : {}),
    acknowledgedAt: input.acknowledgedAt
  }
}

async function regular(path: string, maxBytes: number): Promise<{ path: string; bytes: number }> {
  const [info, resolved] = await Promise.all([lstat(path), realpath(path)])
  if (info.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > maxBytes) {
    throw new Error('adapter source is not a supported regular file')
  }
  return { path: resolved, bytes: info.size }
}

async function copyHash(
  source: string,
  target: string,
  maxBytes: number
): Promise<{ sha256: string; bytes: number }> {
  const input = createReadStream(source, { highWaterMark: 64 * 1024 })
  const output = createWriteStream(target, { flags: 'wx' })
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of input as AsyncIterable<Buffer>) {
      bytes += chunk.length
      if (bytes > maxBytes) throw new Error('adapter file exceeds the size limit')
      hash.update(chunk)
      if (!output.write(chunk)) await new Promise<void>((done) => output.once('drain', done))
    }
    await new Promise<void>((done) => output.end(done))
    return { sha256: hash.digest('hex'), bytes }
  } catch (error) {
    input.destroy()
    output.destroy()
    throw error
  }
}

async function sourceFiles(path: string): Promise<{
  format: ImportedAdapterFormat
  files: { name: ImportedAdapterFile['name']; source: string }[]
}> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error('adapter source cannot be a link')
  if (info.isFile()) {
    if (!path.toLocaleLowerCase().endsWith('.safetensors'))
      throw new Error('adapter file must be Safetensors')
    return {
      format: 'safetensors',
      files: [
        { name: 'adapter.safetensors', source: (await regular(path, MAX_ADAPTER_BYTES)).path }
      ]
    }
  }
  if (!info.isDirectory()) throw new Error('adapter source must be a file or PEFT directory')
  const [weights, config] = await Promise.all([
    regular(join(path, 'adapter_model.safetensors'), MAX_ADAPTER_BYTES),
    regular(join(path, 'adapter_config.json'), MAX_ADAPTER_CONFIG_BYTES)
  ])
  return {
    format: 'peft',
    files: [
      { name: 'adapter_model.safetensors', source: weights.path },
      { name: 'adapter_config.json', source: config.path }
    ]
  }
}

function recordId(format: ImportedAdapterFormat, files: ImportedAdapterFile[]): string {
  const hash = createHash('sha256').update(`iblis-adapter-v1:${format}\0`)
  for (const file of files) hash.update(`${file.name}\0${file.sha256}\0${file.bytes}\0`)
  return `${format}-${hash.digest('hex')}`
}

function validRecord(value: unknown): value is ImportedAdapterRecord {
  // Parsed JSON: a null entry is possible, so every read is guarded.
  const item = value as Partial<ImportedAdapterRecord> | null
  const bytes = item?.bytes
  const expectedFiles =
    item?.format === 'peft'
      ? ['adapter_model.safetensors', 'adapter_config.json']
      : item?.format === 'safetensors'
        ? ['adapter.safetensors']
        : []
  return (
    !!item &&
    typeof item.id === 'string' &&
    /^[a-z]+-[a-f0-9]{64}$/.test(item.id) &&
    (item.format === 'safetensors' || item.format === 'peft') &&
    SHA256.test(item.sha256 ?? '') &&
    typeof bytes === 'number' &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    Number.isSafeInteger(item.importedAt) &&
    Array.isArray(item.files) &&
    item.files.length === expectedFiles.length &&
    item.files.every(
      (file: ImportedAdapterFile | null, index) =>
        !!file &&
        file.name === expectedFiles[index] &&
        SHA256.test(file.sha256) &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes > 0
    ) &&
    item.bytes === item.files.reduce((total, file) => total + file.bytes, 0) &&
    typeof item.displayName === 'string' &&
    (item.sourceOfferId === undefined || typeof item.sourceOfferId === 'string') &&
    Number.isSafeInteger(item.acknowledgedAt)
  )
}

async function readDocument(file: string): Promise<AdapterLibraryDocument> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<AdapterLibraryDocument>
    if (
      parsed.version !== ADAPTER_LIBRARY_VERSION ||
      !Array.isArray(parsed.adapters) ||
      !parsed.adapters.every(validRecord)
    ) {
      throw new Error('invalid')
    }
    return { version: ADAPTER_LIBRARY_VERSION, adapters: parsed.adapters }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT')
      return { version: ADAPTER_LIBRARY_VERSION, adapters: [] }
    throw new Error('adapter library metadata is unavailable', { cause: error })
  }
}

async function writeDocument(file: string, document: AdapterLibraryDocument): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(document, null, 1), 'utf8')
  await rename(temp, file)
}

export interface AdapterLibrary {
  list(): Promise<ImportedAdapterRecord[]>
  import(sourcePath: string, input: AdapterImportDisclosure): Promise<ImportedAdapterRecord>
  remove(id: string): Promise<boolean>
  revealLocation(id: string): Promise<string>
  // The compatibility proof receives only this freshly verified copy. The
  // source library stays intact and no original user path participates.
  copyForCompatibilityProof(id: string, targetRoot: string): Promise<ImportedAdapterRecord>
}

export function createAdapterLibrary(root = adaptersRoot(), now = Date.now): AdapterLibrary {
  const absoluteRoot = resolve(root)
  const metadata = join(absoluteRoot, 'library.json')
  const items = join(absoluteRoot, 'items')
  let chain = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work)
    chain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  return {
    async list(): Promise<ImportedAdapterRecord[]> {
      const document = await readDocument(metadata)
      return structuredClone(document.adapters).sort((a, b) => b.importedAt - a.importedAt)
    },
    import(sourcePath: string, input: AdapterImportDisclosure): Promise<ImportedAdapterRecord> {
      return serial(async () => {
        const info = disclosure(input)
        const source = await sourceFiles(sourcePath)
        const staging = join(absoluteRoot, '.staging', randomBytes(12).toString('hex'))
        await mkdir(staging, { recursive: true })
        try {
          const files: ImportedAdapterFile[] = []
          for (const item of source.files) {
            const staged = join(staging, item.name)
            const copied = await copyHash(
              item.source,
              staged,
              item.name === 'adapter_config.json' ? MAX_ADAPTER_CONFIG_BYTES : MAX_ADAPTER_BYTES
            )
            // Re-validate the staged copy (not the user's path) before it can
            // become a library item — the shell mirror of the server/engine
            // safetensors check, so a pickle/zip or malformed file renamed to
            // .safetensors is refused at the last gate on this side too.
            if (item.name.endsWith('.safetensors')) {
              const problem = await safetensorsProblem(staged)
              if (problem) throw new Error(`this adapter file is not valid safetensors: ${problem}`)
            }
            files.push({ name: item.name, ...copied })
          }
          const id = recordId(source.format, files)
          const document = await readDocument(metadata)
          const existing = document.adapters.find((adapter) => adapter.id === id)
          if (existing) return structuredClone(existing)
          const destination = join(items, id)
          await mkdir(items, { recursive: true })
          await rename(staging, destination)
          const record: ImportedAdapterRecord = {
            id,
            format: source.format,
            sha256: recordId(source.format, files).slice(source.format.length + 1),
            bytes: files.reduce((total, file) => total + file.bytes, 0),
            importedAt: now(),
            files,
            ...info
          }
          document.adapters.push(record)
          await writeDocument(metadata, document)
          return structuredClone(record)
        } catch (error) {
          await rm(staging, { recursive: true, force: true }).catch(ignoreFailure)
          throw error
        }
      })
    },
    remove(id: string): Promise<boolean> {
      return serial(async () => {
        if (!/^[a-z]+-[a-f0-9]{64}$/.test(id)) throw new Error('adapter identity is invalid')
        const document = await readDocument(metadata)
        const index = document.adapters.findIndex((adapter) => adapter.id === id)
        if (index < 0) return false
        const held = join(absoluteRoot, '.removing', randomBytes(12).toString('hex'))
        const source = join(items, id)
        await mkdir(dirname(held), { recursive: true })
        await rename(source, held)
        const [removed] = document.adapters.splice(index, 1)
        try {
          await writeDocument(metadata, document)
        } catch (error) {
          await rename(held, source).catch(ignoreFailure)
          throw error
        }
        await rm(held, { recursive: true, force: true })
        return !!removed
      })
    },
    async revealLocation(id: string): Promise<string> {
      if (!/^[a-z]+-[a-f0-9]{64}$/.test(id)) throw new Error('adapter identity is invalid')
      const document = await readDocument(metadata)
      const record = document.adapters.find((adapter) => adapter.id === id)
      if (!record) throw new Error(`unknown adapter ${id}`)
      const file = record.files[0]
      if (!file) throw new Error('adapter files are unavailable')
      return join(items, record.id, file.name)
    },
    copyForCompatibilityProof(id: string, targetRoot: string): Promise<ImportedAdapterRecord> {
      return serial(async () => {
        if (!/^[a-z]+-[a-f0-9]{64}$/.test(id)) throw new Error('adapter identity is invalid')
        const document = await readDocument(metadata)
        const record = document.adapters.find((adapter) => adapter.id === id)
        if (!record) throw new Error(`unknown adapter ${id}`)

        const sourceRoot = join(items, record.id)
        const sourceInfo = await lstat(sourceRoot)
        if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
          throw new Error('adapter files are unavailable')
        }
        // ace-server discovers a single Safetensors directly under --adapters,
        // while a PEFT pair has its own child directory. Preserve precisely
        // that documented layout in the disposable root.
        const target = record.format === 'peft' ? join(targetRoot, record.id) : targetRoot
        await mkdir(target, { recursive: true })
        const copied: ImportedAdapterFile[] = []
        for (const file of record.files) {
          const max =
            file.name === 'adapter_config.json' ? MAX_ADAPTER_CONFIG_BYTES : MAX_ADAPTER_BYTES
          const source = await regular(join(sourceRoot, file.name), max)
          if (source.bytes !== file.bytes)
            throw new Error('adapter bytes no longer match its record')
          const result = await copyHash(source.path, join(target, file.name), max)
          if (result.sha256 !== file.sha256 || result.bytes !== file.bytes) {
            throw new Error('adapter bytes no longer match their recorded hash')
          }
          copied.push({ name: file.name, ...result })
        }
        if (recordId(record.format, copied) !== record.id) {
          throw new Error('adapter identity no longer matches its managed bytes')
        }
        return structuredClone(record)
      })
    }
  }
}
