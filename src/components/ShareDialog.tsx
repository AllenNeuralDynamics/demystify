import {
  Check,
  Copy,
  Eye,
  Link2,
  LoaderCircle,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import {
  createViewerLink,
  revokeViewerLink,
  type CollaborationRoom,
} from '../lib/github'

interface ShareDialogProps {
  open: boolean
  roomName: string
  room: CollaborationRoom
  canManageViewerLink: boolean
  onClose: () => void
  onRoomRefresh: () => Promise<CollaborationRoom | null>
  onNotice: (message: string) => void
}

const collaboratorUrl = (roomName: string) => {
  const url = new URL(window.location.href)
  url.searchParams.set('doc', roomName)
  url.searchParams.delete('revision')
  url.hash = ''
  return url.toString()
}

const viewerUrl = (roomName: string, token: string) => {
  const url = new URL(collaboratorUrl(roomName))
  url.hash = new URLSearchParams({ view: token }).toString()
  return url.toString()
}

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value)
}

const formatExpiry = (expiresAt: string | null) => {
  if (!expiresAt) return 'No expiration'
  return `Expires ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(expiresAt))}`
}

export const ShareDialog = ({
  open,
  roomName,
  room,
  canManageViewerLink,
  onClose,
  onRoomRefresh,
  onNotice,
}: ShareDialogProps) => {
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30)
  const [generatedViewerUrl, setGeneratedViewerUrl] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [copied, setCopied] = useState<'collaborator' | 'viewer' | null>(null)

  if (!open) return null

  const close = () => {
    setGeneratedViewerUrl(null)
    setCopied(null)
    onClose()
  }

  const copy = async (kind: 'collaborator' | 'viewer', value: string) => {
    try {
      await copyText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1_600)
    } catch {
      onNotice('Could not copy the link')
    }
  }

  const generateViewerLink = async () => {
    setIsWorking(true)
    try {
      const result = await createViewerLink(roomName, expiresInDays)
      setGeneratedViewerUrl(viewerUrl(roomName, result.token))
      await onRoomRefresh()
      onNotice(room.viewerLink ? 'Viewer link replaced' : 'Viewer link created')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not create viewer link')
    } finally {
      setIsWorking(false)
    }
  }

  const revoke = async () => {
    setIsWorking(true)
    try {
      await revokeViewerLink(roomName)
      setGeneratedViewerUrl(null)
      await onRoomRefresh()
      onNotice('Viewer access revoked')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not revoke viewer link')
    } finally {
      setIsWorking(false)
    }
  }

  const editorLink = collaboratorUrl(roomName)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="share-dialog-header">
          <div>
            <Link2 size={18} />
            <div>
              <h2 id="share-dialog-title">Share manuscript</h2>
              <p>Choose editing access or a revocable view-only link.</p>
            </div>
          </div>
          <button className="icon-button" type="button" title="Close share dialog" onClick={close}>
            <X size={17} />
          </button>
        </header>

        <div className="share-dialog-body">
          <section className="share-access-row">
            <div className="share-access-icon"><Link2 size={16} /></div>
            <div className="share-access-copy">
              <strong>Collaborator link</strong>
              <span>GitHub sign-in and repository write access required.</span>
              <div className="share-link-control">
                <input aria-label="Collaborator link" readOnly value={editorLink} />
                <button type="button" title="Copy collaborator link" onClick={() => void copy('collaborator', editorLink)}>
                  {copied === 'collaborator' ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          </section>

          <section className="share-access-row viewer-access-row">
            <div className="share-access-icon viewer"><Eye size={16} /></div>
            <div className="share-access-copy">
              <strong>Viewer link</strong>
              <span>Anyone with the link can read live text, preview, and comments.</span>

              {generatedViewerUrl && (
                <div className="share-link-control generated-viewer-link">
                  <input aria-label="Viewer link" readOnly value={generatedViewerUrl} />
                  <button type="button" title="Copy viewer link" onClick={() => void copy('viewer', generatedViewerUrl)}>
                    {copied === 'viewer' ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              )}

              {room.viewerLink && (
                <div className="viewer-link-status">
                  <span className="viewer-status-dot" />
                  <span>Active</span>
                  <span>{formatExpiry(room.viewerLink.expiresAt)}</span>
                </div>
              )}

              {canManageViewerLink ? (
                <div className="viewer-link-actions">
                  <label>
                    Expiration
                    <select
                      value={expiresInDays === null ? 'never' : String(expiresInDays)}
                      onChange={(event) => setExpiresInDays(
                        event.target.value === 'never' ? null : Number(event.target.value),
                      )}
                    >
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="never">No expiration</option>
                    </select>
                  </label>
                  <button className="button primary-button" type="button" disabled={isWorking} onClick={() => void generateViewerLink()}>
                    {isWorking
                      ? <LoaderCircle className="spin" size={14} />
                      : room.viewerLink
                        ? <RotateCw size={14} />
                        : <Eye size={14} />}
                    {room.viewerLink ? 'Replace link' : 'Create viewer link'}
                  </button>
                  {room.viewerLink && (
                    <button className="button danger-button" type="button" disabled={isWorking} onClick={() => void revoke()}>
                      <Trash2 size={14} /> Revoke
                    </button>
                  )}
                </div>
              ) : (
                <p className="share-owner-note">Only the room owner can manage viewer access.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
