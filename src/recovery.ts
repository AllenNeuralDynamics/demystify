import { EditorView } from '@codemirror/view'
import type { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'
import { createCollaborationRecovery, getVisualDraftsForRecovery } from './lib/collaborationRecovery'
import type { ServerSaveStatus } from './lib/collaborationDurability'

interface RecoveryContext {
  document: Y.Doc
  roomName: string
  connected: boolean
  providerSynced: boolean
  sourceFilePath?: string | null
  serverSaveStatus?: ServerSaveStatus
  accessError?: string | null
}

interface EditorFiber {
  key?: string | null
  memoizedProps?: {
    sharedText?: Y.Text
    provider?: WebsocketProvider
  }
  return?: EditorFiber | null
}

export const downloadRoomRecovery = (context: RecoveryContext) => {
  const editor = document.querySelector<HTMLElement>('.cm-content')
  const view = editor ? EditorView.findFromDOM(editor) : null
  const backup = {
    ...createCollaborationRecovery(context.document, context.roomName),
    connectionAtExport: {
      connected: context.connected,
      providerSynced: context.providerSynced,
      serverSaveStatus: context.serverSaveStatus ?? null,
      accessError: context.accessError ?? null,
    },
    localDrafts: {
      sourceFilePath: context.sourceFilePath ?? null,
      source: view?.state.doc.toString() ?? null,
      selection: view ? {
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      } : null,
      comment: document.querySelector<HTMLTextAreaElement>('[aria-label="New comment"]')?.value ?? null,
      replies: Array.from(document.querySelectorAll<HTMLTextAreaElement>(
        'textarea[aria-label^="Reply to comment"]',
      ), (field) => ({ label: field.getAttribute('aria-label'), text: field.value })),
      visualEditorHtml: document.querySelector<HTMLElement>(
        '.is-visual-editing [contenteditable="true"], .continuous-visual-document',
      )?.innerHTML ?? null,
      visualDrafts: getVisualDraftsForRecovery(document.querySelector<HTMLElement>(
        '.continuous-visual-document',
      )?.dataset.visualDraftKey),
    },
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const room = context.roomName.replace(/[^a-zA-Z0-9_-]/g, '_')
  const filename = `demystify-recovery-${room}-${backup.exportedAt.replaceAll(':', '-')}.json`
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { filename, bytes: blob.size, ...backup.counts }
}

export const downloadCurrentRoomRecovery = () => {
  const roomName = new URL(window.location.href).searchParams.get('doc')
  if (!roomName) throw new Error('Run this exporter in the original manuscript tab.')
  let element: Element | null = document.querySelector('.cm-content')
  while (element) {
    const property = Object.keys(element).find((key) => key.startsWith('__reactFiber$'))
    if (property) {
      let fiber: EditorFiber | null | undefined =
        (element as unknown as Record<string, EditorFiber>)[property]
      for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
        const sharedText = fiber.memoizedProps?.sharedText
        const provider = fiber.memoizedProps?.provider
        if (!sharedText?.doc || !provider) continue
        if (provider.roomname !== roomName || provider.doc !== sharedText.doc) {
          throw new Error('The loaded editor does not match the room URL. Nothing was exported.')
        }
        return downloadRoomRecovery({
          document: sharedText.doc,
          roomName,
          connected: provider.wsconnected,
          providerSynced: provider.synced,
          sourceFilePath: fiber.key,
        })
      }
    }
    element = element.parentElement
  }
  throw new Error('The source editor could not be found. Select Source or Split view without refreshing, then retry.')
}