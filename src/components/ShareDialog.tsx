import {
  Check,
  Copy,
  Eye,
  Link2,
  LoaderCircle,
  PencilLine,
  RotateCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createShareLink,
  getCollaborationRoomUrl,
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

const anonymousUrl = (
  roomName: string,
  token: string,
  role: AnonymousShareRole,
) => {
  const url = new URL(getCollaborationRoomUrl(roomName))
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

const shareRoleLabel = (role: AnonymousShareRole) =>
  role === 'viewer' ? 'Viewer' : 'Suggestion mode'

interface StoredShareLink {
  url: string
  fingerprint: string
  confirmedAt: string
  expiresAt: string | null
}
type StoredShareLinks = Partial<Record<AnonymousShareRole, StoredShareLink>>
const shareStorageKey = (roomName: string, ownerId: number) => `demystify.share-links:${JSON.stringify([roomName, ownerId])}`
const readStoredLinks = (roomName: string, ownerId: number): StoredShareLinks => {
  try {
    const value = JSON.parse(sessionStorage.getItem(shareStorageKey(roomName, ownerId)) ?? '{}') as Record<string, Partial<StoredShareLink>>
    const links: StoredShareLinks = {}
    for (const role of ['collaborator', 'viewer'] as const) {
      const entry = value[role]
      if (!entry || typeof entry.url !== 'string' || typeof entry.fingerprint !== 'string' ||
        typeof entry.confirmedAt !== 'string' || Number.isNaN(Date.parse(entry.confirmedAt)) ||
        (entry.expiresAt !== null && (typeof entry.expiresAt !== 'string' || Number.isNaN(Date.parse(entry.expiresAt))))) continue
      const url = new URL(entry.url)
      const token = new URLSearchParams(url.hash.slice(1)).get(role === 'viewer' ? 'view' : 'collaborate')
      if (url.origin !== location.origin || url.searchParams.get('doc') !== roomName || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) continue
      links[role] = { url: anonymousUrl(roomName, token, role), fingerprint: entry.fingerprint,
        confirmedAt: entry.confirmedAt, expiresAt: entry.expiresAt }
    }
    return links
  } catch { return {} }
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
  const scope = JSON.stringify([roomName, room.ownerId])
  const [clock, setClock] = useState(Date.now)
  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.resolve().then(() => { if (active) setClock(Date.now()) })
    const timer = window.setInterval(() => setClock(Date.now()), 10_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [open])
  const [storedLinks, setStoredLinks] = useState(() => ({ scope,
    links: canManageLinks ? readStoredLinks(roomName, room.ownerId) : {} as StoredShareLinks }))
  const links = canManageLinks && storedLinks.scope === scope ? storedLinks.links : {}
  const generatedUrls = Object.fromEntries((['collaborator', 'viewer'] as const).flatMap((role) => {
    const entry = links[role]
    const metadata = role === 'viewer' ? room.viewerLink : room.collaboratorLink
    if (!entry || (entry.expiresAt && Date.parse(entry.expiresAt) <= clock)) return []
    const matching = metadata && entry.fingerprint === (metadata.id ?? metadata.createdAt)
    const pendingRefresh = Date.parse(room.updatedAt) < Date.parse(entry.confirmedAt)
    return matching || pendingRefresh ? [[role, entry.url]] : []
  })) as Partial<Record<AnonymousShareRole, string>>
  const [workingRole, setWorkingRole] = useState<AnonymousShareRole | null>(null)
  const [copied, setCopied] = useState<'maintainer' | 'collaborator' | 'viewer' | null>(null)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setCopied(null)
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  const close = () => {
    setCopied(null)
    onClose()
  }

  const copy = async (kind: 'maintainer' | 'collaborator' | 'viewer', value: string) => {
    try {
      await copyText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1_600)
    } catch {
      onNotice('Could not copy the link')
    }
  }

  const storeLinks = (values: StoredShareLinks) => {
    setStoredLinks({ scope, links: values })
    try { sessionStorage.setItem(shareStorageKey(roomName, room.ownerId), JSON.stringify(values)) }
    catch { onNotice('The link is visible now, but this tab could not retain it across reloads.') }
  }

  const generateLink = async (role: AnonymousShareRole) => {
    if (!canManageLinks) return
    setWorkingRole(role)
    try {
      const result = await createShareLink(roomName, expirations[role], role)
      storeLinks({ ...links, [role]: { url: anonymousUrl(roomName, result.token, role),
        fingerprint: result.link.id ?? result.link.createdAt, confirmedAt: result.link.createdAt, expiresAt: result.link.expiresAt } })
      await onRoomRefresh()
      const existing = role === 'viewer' ? room.viewerLink : room.collaboratorLink
      onNotice(`${shareRoleLabel(role)} link ${existing ? 'replaced' : 'created'}`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Could not create ${role} link`)
    } finally {
      setWorkingRole(null)
    }
  }

  const revoke = async (role: AnonymousShareRole) => {
    if (!canManageLinks) return
    setWorkingRole(role)
    try {
      await revokeShareLink(roomName, role)
      storeLinks({ ...links, [role]: undefined })
      await onRoomRefresh()
      onNotice(`${shareRoleLabel(role)} access revoked`)
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
              <p>Choose a clear role for each person who joins this room.</p>
            </div>
          </div>
          <button className="icon-button" type="button" title="Close share dialog" onClick={close}>
            <X size={17} />
          </button>
        </header>

        <div className="share-dialog-body">
          <section className="share-access-row maintainer-access-row">
            <div className="share-access-icon maintainer"><ShieldCheck size={16} /></div>
            <div className="share-access-copy">
              <strong>Room link</strong>
              <span>The link grants no authority by itself. Existing room access is required; publishing and sharing management remain restricted.</span>
              <div className="share-link-control maintainer-link-control">
                <input aria-label="Room link" readOnly value={getCollaborationRoomUrl(roomName)} onFocus={(event) => event.currentTarget.select()} />
                <button type="button" title="Copy room link" onClick={() => void copy('maintainer', getCollaborationRoomUrl(roomName))}>
                  {copied === 'maintainer' ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          </section>

          <section className="share-access-row">
            <div className="share-access-icon"><PencilLine size={16} /></div>
            <div className="share-access-copy">
              <strong>Suggestion mode</strong>
              <span>Anyone with the link can submit attributed Source or Visual suggestions and reply to comments. Maintainers accept or reject each suggestion independently, and only maintainers submit accepted source to GitHub.</span>

              {generatedUrls.collaborator && (
                <div className="share-link-control generated-collaborator-link">
                  <input aria-label="Suggestion link" readOnly value={generatedUrls.collaborator} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" title="Copy suggestion link" onClick={() => void copy('collaborator', generatedUrls.collaborator as string)}>
                    {copied === 'collaborator' ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              )}

              {room.collaboratorLink && (
                <div className="viewer-link-status">
                  <span className="viewer-status-dot" />
                  <span>{room.collaboratorLink.expiresAt && Date.parse(room.collaboratorLink.expiresAt) <= clock ? 'Expired' : 'Active'}</span>
                  <span>{formatExpiry(room.collaboratorLink.expiresAt)}</span>
                </div>
              )}
              {canManageLinks && room.collaboratorLink && !generatedUrls.collaborator && <p className="share-owner-note" role="status">Active link URL unavailable in this tab.</p>}

              {canManageLinks ? (
                <div className="viewer-link-actions">
                  <label>
                    Expiration
                    <select
                      aria-label="Suggestion link expiration"
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
                    {room.collaboratorLink ? 'Replace link' : 'Create suggestion link'}
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
              <strong>Viewer</strong>
              <span>Anyone with the link can read live text, preview, and comments. Editing and publishing are disabled.</span>

              {generatedUrls.viewer && (
                <div className="share-link-control generated-viewer-link">
                  <input aria-label="Viewer link" readOnly value={generatedUrls.viewer} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" title="Copy viewer link" onClick={() => void copy('viewer', generatedUrls.viewer as string)}>
                    {copied === 'viewer' ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              )}

              {room.viewerLink && (
                <div className="viewer-link-status">
                  <span className="viewer-status-dot" />
                  <span>{room.viewerLink.expiresAt && Date.parse(room.viewerLink.expiresAt) <= clock ? 'Expired' : 'Active'}</span>
                  <span>{formatExpiry(room.viewerLink.expiresAt)}</span>
                </div>
              )}
              {canManageLinks && room.viewerLink && !generatedUrls.viewer && <p className="share-owner-note" role="status">Active link URL unavailable in this tab.</p>}

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
