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
  createShareLink,
  revokeShareLink,
  type AnonymousShareRole,
  type CollaborationRoom,
} from '../lib/github'

interface ShareDialogProps {
  open: boolean
  roomName: string
  room: CollaborationRoom
  canManageLinks: boolean
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

const anonymousUrl = (
  roomName: string,
  token: string,
  role: AnonymousShareRole,
) => {
  const url = new URL(collaboratorUrl(roomName))
  url.hash = new URLSearchParams({
    [role === 'viewer' ? 'view' : 'collaborate']: token,
  }).toString()
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
  canManageLinks,
  onClose,
  onRoomRefresh,
  onNotice,
}: ShareDialogProps) => {
  const [expirations, setExpirations] = useState<Record<AnonymousShareRole, number | null>>({
    collaborator: 30,
    viewer: 30,
  })
  const [generatedUrls, setGeneratedUrls] = useState<Partial<Record<AnonymousShareRole, string>>>({})
  const [workingRole, setWorkingRole] = useState<AnonymousShareRole | null>(null)
  const [copied, setCopied] = useState<'collaborator' | 'viewer' | null>(null)

  if (!open) return null

  const close = () => {
    setGeneratedUrls({})
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

  const generateLink = async (role: AnonymousShareRole) => {
    setWorkingRole(role)
    try {
      const result = await createShareLink(roomName, expirations[role], role)
      setGeneratedUrls((current) => ({
        ...current,
        [role]: anonymousUrl(roomName, result.token, role),
      }))
      await onRoomRefresh()
      const existing = role === 'viewer' ? room.viewerLink : room.collaboratorLink
      onNotice(`${role === 'viewer' ? 'Viewer' : 'Collaborator'} link ${existing ? 'replaced' : 'created'}`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Could not create ${role} link`)
    } finally {
      setWorkingRole(null)
    }
  }

  const revoke = async (role: AnonymousShareRole) => {
    setWorkingRole(role)
    try {
      await revokeShareLink(roomName, role)
      setGeneratedUrls((current) => ({ ...current, [role]: undefined }))
      await onRoomRefresh()
      onNotice(`${role === 'viewer' ? 'Viewer' : 'Collaborator'} access revoked`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Could not revoke ${role} link`)
    } finally {
      setWorkingRole(null)
    }
  }

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
              <span>Anyone with the link can read; GitHub sign-in and repository write access unlock editing.</span>

              {generatedUrls.collaborator && (
                <div className="share-link-control generated-collaborator-link">
                  <input aria-label="Collaborator link" readOnly value={generatedUrls.collaborator} />
                  <button type="button" title="Copy collaborator link" onClick={() => void copy('collaborator', generatedUrls.collaborator as string)}>
                    {copied === 'collaborator' ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              )}

              {room.collaboratorLink && (
                <div className="viewer-link-status">
                  <span className="viewer-status-dot" />
                  <span>Active</span>
                  <span>{formatExpiry(room.collaboratorLink.expiresAt)}</span>
                </div>
              )}

              {canManageLinks ? (
                <div className="viewer-link-actions">
                  <label>
                    Expiration
                    <select
                      aria-label="Collaborator expiration"
                      value={expirations.collaborator === null ? 'never' : String(expirations.collaborator)}
                      onChange={(event) => setExpirations((current) => ({
                        ...current,
                        collaborator: event.target.value === 'never' ? null : Number(event.target.value),
                      }))}
                    >
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="never">No expiration</option>
                    </select>
                  </label>
                  <button className="button primary-button" type="button" disabled={workingRole !== null} onClick={() => void generateLink('collaborator')}>
                    {workingRole === 'collaborator'
                      ? <LoaderCircle className="spin" size={14} />
                      : room.collaboratorLink
                        ? <RotateCw size={14} />
                        : <Link2 size={14} />}
                    {room.collaboratorLink ? 'Replace link' : 'Create collaborator link'}
                  </button>
                  {room.collaboratorLink && (
                    <button className="button danger-button" type="button" disabled={workingRole !== null} onClick={() => void revoke('collaborator')}>
                      <Trash2 size={14} /> Revoke
                    </button>
                  )}
                </div>
              ) : (
                <p className="share-owner-note">Only the room owner can manage sharing links.</p>
              )}
            </div>
          </section>

          <section className="share-access-row viewer-access-row">
            <div className="share-access-icon viewer"><Eye size={16} /></div>
            <div className="share-access-copy">
              <strong>Viewer link</strong>
              <span>Anyone with the link can read live text, preview, and comments.</span>

              {generatedUrls.viewer && (
                <div className="share-link-control generated-viewer-link">
                  <input aria-label="Viewer link" readOnly value={generatedUrls.viewer} />
                  <button type="button" title="Copy viewer link" onClick={() => void copy('viewer', generatedUrls.viewer as string)}>
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

              {canManageLinks ? (
                <div className="viewer-link-actions">
                  <label>
                    Expiration
                    <select
                      aria-label="Viewer expiration"
                      value={expirations.viewer === null ? 'never' : String(expirations.viewer)}
                      onChange={(event) => setExpirations((current) => ({
                        ...current,
                        viewer: event.target.value === 'never' ? null : Number(event.target.value),
                      }))}
                    >
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="never">No expiration</option>
                    </select>
                  </label>
                  <button className="button primary-button" type="button" disabled={workingRole !== null} onClick={() => void generateLink('viewer')}>
                    {workingRole === 'viewer'
                      ? <LoaderCircle className="spin" size={14} />
                      : room.viewerLink
                        ? <RotateCw size={14} />
                        : <Eye size={14} />}
                    {room.viewerLink ? 'Replace link' : 'Create viewer link'}
                  </button>
                  {room.viewerLink && (
                    <button className="button danger-button" type="button" disabled={workingRole !== null} onClick={() => void revoke('viewer')}>
                      <Trash2 size={14} /> Revoke
                    </button>
                  )}
                </div>
              ) : (
                <p className="share-owner-note">Only the room owner can manage sharing links.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
