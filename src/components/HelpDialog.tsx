import { CircleHelp, Eye, GitPullRequest, MessageSquareText, Radio, X } from 'lucide-react'
import { useEffect } from 'react'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

export const HelpDialog = ({ open, onClose }: HelpDialogProps) => {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-dialog-header">
          <div>
            <CircleHelp size={19} />
            <div>
              <h2 id="help-dialog-title">How DeMystify works</h2>
              <p>Write together now; publish deliberately through GitHub.</p>
            </div>
          </div>
          <button
            autoFocus
            className="icon-button"
            type="button"
            title="Close help"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <ol className="help-flow">
          <li>
            <span className="help-step-icon"><Radio size={18} /></span>
            <div>
              <strong>Live room</strong>
              <p>Text, cursors, and comments synchronize immediately. Select Source text to copy, cut, format, or anchor a comment; press Command/Control+Option+M to open the comment composer. Nothing is committed while you type.</p>
            </div>
          </li>
          <li>
            <span className="help-step-icon"><Eye size={18} /></span>
            <div>
              <strong>Browser preview</strong>
              <p>A fast reading aid for the open MyST file. It updates after a short pause and uses committed static figures. Split panes scroll independently; use the outline or select an inline review change to align Source. Repository plugins, styles, and interactive figures remain part of the publication build.</p>
            </div>
          </li>
          <li>
            <span className="help-step-icon"><GitPullRequest size={18} /></span>
            <div>
              <strong>GitHub snapshot</strong>
              <p>Save to GitHub updates this room's branch and draft pull request. Repository CI remains the authoritative publication check.</p>
            </div>
          </li>
        </ol>

        <div className="help-comment-note">
          <MessageSquareText size={17} />
          <p>Suggestion links open one live working manuscript in Source and Visual. Everyone sees edits immediately. Pending changes turn Editing into Review changes; a maintainer then accepts all or discards all before submitting accepted MyST to GitHub. Only an author can edit their comment or reply, while everyone with editing access can reply. Revoked or expired links stop editing immediately.</p>
        </div>
      </section>
    </div>
  )
}
