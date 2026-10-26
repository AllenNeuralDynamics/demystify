import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { gzipSync, gunzipSync } from 'node:zlib'
import { diffChars } from 'diff'
import type * as Yjs from 'yjs'
import { ApiError } from './github.js'
import type { ReadyYjsPersistence } from './database.js'
import type { DocumentSnapshot, DocumentVersion, VersionAuthor, VersionPage, VersionPreview } from '../src/lib/documentHistory.js'

const require = createRequire(import.meta.url)
const Y = require('yjs') as typeof Yjs
const restoreOrigin = Symbol('document-history-restore')
const metadataKeys = ['initialized', 'workingContentInitialized', 'bibliographyInitialized', 'bibliographyPath',
  'mystConfigInitialized', 'mystConfigPath', 'projectFilesInitialized', 'projectManifestVersion', 'primaryFilePath', 'lineEnding']

interface StoredVersion {
  version: DocumentVersion
  revision: string
  payload: string
}

interface TrackedDocument {
  authors: Map<string, VersionAuthor>
  generation: number
  idle?: ReturnType<typeof setTimeout>
  maximum?: ReturnType<typeof setTimeout>
}

const sortedEntries = <Value>(map: Yjs.Map<Value>) => Array.from(map.entries())
  .sort(([first], [second]) => first.localeCompare(second))

export const historyRoomKey = (roomName: string) => `history:${createHash('sha256').update(roomName).digest('hex')}`

export const captureDocumentSnapshot = (document: Yjs.Doc): DocumentSnapshot => ({
  format: 1,
  content: document.getText('content').toString(),
  workingContent: document.getText('workingContent').toString(),
  bibliography: document.getText('bibliography').toString(),
  mystConfig: document.getText('mystConfig').toString(),
  projectFiles: sortedEntries(document.getMap<Yjs.Text>('projectFiles')).map(([path, text]) => [path, text.toString()]),
  references: sortedEntries(document.getMap('references')),
  contributors: sortedEntries(document.getMap('proposalContributors')),
  metadata: metadataKeys.filter((key) => document.getMap('metadata').has(key))
    .map((key) => [key, document.getMap('metadata').get(key)]),
})

export const snapshotRevision = (snapshot: DocumentSnapshot) => createHash('sha256')
  .update(JSON.stringify(snapshot)).digest('hex')

const replaceText = (text: Yjs.Text, source: string) => {
  let position = 0
  for (const part of diffChars(text.toString(), source)) {
    if (part.removed) text.delete(position, part.value.length)
    else if (part.added) {
      text.insert(position, part.value)
      position += part.value.length
    } else position += part.value.length
  }
}

const restoreMap = (map: Yjs.Map<unknown>, entries: Array<[string, unknown]>) => {
  const values = new Map(entries)
  for (const key of map.keys()) if (!values.has(key)) map.delete(key)
  for (const [key, value] of values) {
    if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) map.set(key, value)
  }
}

const applySnapshot = (document: Yjs.Doc, snapshot: DocumentSnapshot) => document.transact(() => {
  for (const key of ['content', 'workingContent', 'bibliography', 'mystConfig'] as const) {
    replaceText(document.getText(key), snapshot[key])
  }
  const files = document.getMap<Yjs.Text>('projectFiles')
  const paths = new Set(snapshot.projectFiles.map(([path]) => path))
  for (const path of files.keys()) if (!paths.has(path)) files.delete(path)
  for (const [path, source] of snapshot.projectFiles) {
    const text = files.get(path)
    if (text) replaceText(text, source)
    else files.set(path, new Y.Text(source))
  }
  restoreMap(document.getMap('references'), snapshot.references)
  restoreMap(document.getMap('proposalContributors'), snapshot.contributors)
  const metadata = document.getMap('metadata')
  const saved = new Map(snapshot.metadata)
  for (const key of metadataKeys) {
    if (saved.has(key)) metadata.set(key, saved.get(key))
    else metadata.delete(key)
  }
}, restoreOrigin)

export class DocumentHistory {
  private readonly stores = new Map<string, Promise<Yjs.Doc>>()
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly tracked = new WeakMap<Yjs.Doc, TrackedDocument>()

  constructor(private readonly persistence: ReadyYjsPersistence, private readonly options: {
    actor?: (origin: unknown) => VersionAuthor | undefined
    idleMilliseconds?: number
    maximumMilliseconds?: number
  } = {}) {}

  track(roomName: string, document: Yjs.Doc) {
    if (this.tracked.has(document)) return
    const tracked: TrackedDocument = { authors: new Map(), generation: 0 }
    this.tracked.set(document, tracked)
    const roots = ['content', 'workingContent', 'bibliography', 'mystConfig', 'projectFiles', 'references', 'proposalContributors', 'metadata']
    document.on('afterTransaction', (transaction: Yjs.Transaction) => {
      if (transaction.origin === restoreOrigin || !roots.some((root) =>
        transaction.changedParentTypes.has(document.share.get(root) as Yjs.AbstractType<Yjs.YEvent<Yjs.AbstractType<unknown>>>),
      )) return
      tracked.generation += 1
      const actor = this.options.actor?.(transaction.origin)
      if (actor) tracked.authors.set(actor.id, actor)
      clearTimeout(tracked.idle)
      const save = () => {
        clearTimeout(tracked.idle)
        clearTimeout(tracked.maximum)
        tracked.idle = undefined
        tracked.maximum = undefined
        if (!document.isDestroyed) void this.checkpoint(roomName, document).catch((error: unknown) => {
          console.error('Could not save manuscript history:', error)
        })
      }
      tracked.idle = setTimeout(save, this.options.idleMilliseconds ?? 5_000)
      tracked.idle.unref()
      if (!tracked.maximum) {
        tracked.maximum = setTimeout(save, this.options.maximumMilliseconds ?? 30_000)
        tracked.maximum.unref()
      }
    })
    document.once('destroy', () => {
      clearTimeout(tracked.idle)
      clearTimeout(tracked.maximum)
    })
  }

  checkpoint(roomName: string, document: Yjs.Doc, kind: DocumentVersion['kind'] = 'automatic',
    actor?: VersionAuthor, name?: string, gitCommit?: string) {
    return this.queue(roomName, async () => {
      await this.persistence.waitForHydration(document)
      if (document.getMap('metadata').get('initialized') !== true) return null
      const snapshot = captureDocumentSnapshot(document)
      const tracked = this.tracked.get(document)
      const generation = tracked?.generation
      const authors = actor ? [actor] : Array.from(tracked?.authors.values() ?? [])
      await this.persistence.flush(roomName, document)
      const store = await this.store(roomName)
      const result = await this.append(roomName, store, snapshot, kind, authors, name, undefined, gitCommit)
      if (tracked && tracked.generation === generation) tracked.authors.clear()
      return result
    })
  }

  async list(roomName: string, document: Yjs.Doc, before?: number): Promise<VersionPage> {
    await this.checkpoint(roomName, document)
    const store = await this.store(roomName)
    const all = Array.from(store.getMap<StoredVersion>('versions').values())
      .map((entry) => entry.version).filter((version) => before === undefined || version.sequence < before)
      .sort((first, second) => second.sequence - first.sequence)
    const versions = all.slice(0, 50)
    return { versions, nextCursor: all.length > versions.length ? versions.at(-1)?.sequence ?? null : null,
      revision: snapshotRevision(captureDocumentSnapshot(document)) }
  }

  async preview(roomName: string, document: Yjs.Doc, id: string): Promise<VersionPreview> {
    await this.checkpoint(roomName, document)
    const store = await this.store(roomName)
    const stored = this.getVersion(store, id)
    const current = captureDocumentSnapshot(document)
    return { version: stored.version, snapshot: await this.decode(stored), current, revision: snapshotRevision(current) }
  }

  rename(roomName: string, id: string, name: string) {
    return this.queue(roomName, async () => {
      const store = await this.store(roomName)
      const stored = this.getVersion(store, id)
      const version = { ...stored.version, name }
      store.getMap<StoredVersion>('versions').set(id, { ...stored, version })
      await this.persistence.flush(historyRoomKey(roomName), store)
      return version
    })
  }

  restore(roomName: string, document: Yjs.Doc, id: string, expectedRevision: string, actor: VersionAuthor) {
    return this.queue(roomName, async () => {
      await this.persistence.waitForHydration(document)
      const store = await this.store(roomName)
      const stored = this.getVersion(store, id)
      const target = await this.decode(stored)
      const before = captureDocumentSnapshot(document)
      const assertCurrent = () => {
        if (snapshotRevision(captureDocumentSnapshot(document)) !== expectedRevision) {
          throw new ApiError(409, 'The draft changed after this preview. Refresh the preview before restoring.')
        }
      }
      assertCurrent()
      await this.persistence.flush(roomName, document)
      await this.append(roomName, store, before, 'safety', [actor], 'Before restore')
      assertCurrent()
      applySnapshot(document, target)
      const restored = captureDocumentSnapshot(document)
      await this.persistence.flush(roomName, document)
      return this.append(roomName, store, restored, 'restore', [actor], null, id)
    })
  }

  async release(roomName: string) {
    await this.operations.get(roomName)
    const promise = this.stores.get(roomName)
    if (!promise) return
    const store = await promise
    await this.persistence.writeState(historyRoomKey(roomName), store)
    this.stores.delete(roomName)
    store.destroy()
  }

  private store(roomName: string) {
    let promise = this.stores.get(roomName)
    if (!promise) {
      const document = new Y.Doc()
      this.persistence.bindState(historyRoomKey(roomName), document)
      promise = this.persistence.waitForHydration(document).then(() => document).catch((error: unknown) => {
        if (this.stores.get(roomName) === promise) this.stores.delete(roomName)
        document.destroy()
        throw error
      })
      this.stores.set(roomName, promise)
    }
    return promise
  }

  private getVersion(store: Yjs.Doc, id: string) {
    const value = store.getMap<StoredVersion>('versions').get(id)
    if (!value) throw new ApiError(404, 'This manuscript version does not exist.')
    return value
  }

  private async decode(stored: StoredVersion) {
    const document = new Y.Doc()
    this.persistence.bindState(stored.payload, document)
    try {
      await this.persistence.waitForHydration(document)
      const data = document.getText('payload').toString()
      const snapshot = JSON.parse(gunzipSync(Buffer.from(data, 'base64'), { maxOutputLength: 20_000_000 }).toString('utf8')) as DocumentSnapshot
      if (snapshot.format !== 1 || snapshotRevision(snapshot) !== stored.revision) {
        throw new ApiError(500, 'This manuscript version failed its integrity check.')
      }
      await this.persistence.writeState(stored.payload, document)
      return snapshot
    } finally {
      document.destroy()
    }
  }

  private async append(roomName: string, store: Yjs.Doc, snapshot: DocumentSnapshot,
    kind: DocumentVersion['kind'], authors: VersionAuthor[], name?: string | null,
    restoredFrom?: string, gitCommit?: string) {
    const versions = store.getMap<StoredVersion>('versions')
    const latest = Array.from(versions.values()).sort((first, second) => second.version.sequence - first.version.sequence)[0]
    const revision = snapshotRevision(snapshot)
    if (kind === 'automatic' && latest?.revision === revision) {
      await this.persistence.flush(historyRoomKey(roomName), store)
      return latest.version
    }
    const version: DocumentVersion = {
      id: randomUUID(), sequence: (latest?.version.sequence ?? 0) + 1,
      createdAt: new Date().toISOString(), name: name ?? null, kind, authors,
      ...(restoredFrom ? { restoredFrom } : {}), ...(gitCommit ? { gitCommit } : {}),
    }
    const data = Buffer.from(JSON.stringify(snapshot))
    if (data.length > 20_000_000) throw new ApiError(413, 'This manuscript is too large for a history checkpoint.')
    const payload = historyRoomKey(`${roomName}:${version.id}`)
    const document = new Y.Doc()
    this.persistence.bindState(payload, document)
    try {
      await this.persistence.waitForHydration(document)
      document.getText('payload').insert(0, gzipSync(data).toString('base64'))
      await this.persistence.writeState(payload, document)
    } finally { document.destroy() }
    versions.set(version.id, { version, revision, payload })
    await this.persistence.flush(historyRoomKey(roomName), store)
    return version
  }

  private queue<Result>(roomName: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.operations.get(roomName) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.operations.set(roomName, next)
    const cleanup = () => { if (this.operations.get(roomName) === next) this.operations.delete(roomName) }
    void next.then(cleanup, cleanup)
    return next
  }
}