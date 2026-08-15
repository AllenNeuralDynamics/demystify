import {
  BookOpenText,
  CheckCircle2,
  CircleHelp,
  Code2,
  Eye,
  GitPullRequest,
  Info,
  Keyboard,
  MessageSquareText,
  Radio,
  Share2,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

type HelpTopic = 'overview' | 'editing' | 'review' | 'publish' | 'shortcuts' | 'about'

const helpTopics: Array<{ id: HelpTopic, label: string, icon: LucideIcon }> = [
  { id: 'overview', label: 'Start here', icon: BookOpenText },
  { id: 'editing', label: 'Writing', icon: Code2 },
  { id: 'review', label: 'Review', icon: MessageSquareText },
  { id: 'publish', label: 'Share and publish', icon: GitPullRequest },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
]

const HelpItem = ({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) => (
  <section className="help-guide-item">
    <span className="help-guide-icon"><Icon size={18} aria-hidden="true" /></span>
    <div>
      <h4>{title}</h4>
      <p>{children}</p>
    </div>
  </section>
)

const TopicHeader = ({ title, children }: { title: string, children: ReactNode }) => (
  <header className="help-topic-header">
    <h3 id="help-topic-title">{title}</h3>
    <p>{children}</p>
  </header>
)

export const HelpDialog = ({ open, onClose }: HelpDialogProps) => {
  const [activeTopic, setActiveTopic] = useState<HelpTopic>('overview')

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
              <p>Practical guidance for writing, reviewing, and publishing a shared MyST manuscript.</p>
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

        <div className="help-dialog-body">
          <nav className="help-topic-nav" aria-label="Help topics">
            <span>Guide</span>
            {helpTopics.map((topic) => {
              const Icon = topic.icon
              return (
                <button
                  aria-current={activeTopic === topic.id ? 'page' : undefined}
                  key={topic.id}
                  type="button"
                  onClick={() => setActiveTopic(topic.id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {topic.label}
                </button>
              )
            })}
            <small>DeMystify {__DEMYSTIFY_VERSION__}</small>
          </nav>

          <div className="help-topic-content" role="region" aria-labelledby="help-topic-title">
            {activeTopic === 'overview' && (
              <>
                <TopicHeader title="Write together, publish deliberately">
                  DeMystify keeps live collaboration fast while preserving MyST source and GitHub review as the durable scientific record.
                </TopicHeader>
                <div className="help-guide-list">
                  <HelpItem icon={Radio} title="Work in the live room">
                    Text, cursors, comments, and suggestions synchronize immediately. A Live status means your room has caught up with the collaboration server; it does not mean the draft has been committed.
                  </HelpItem>
                  <HelpItem icon={MessageSquareText} title="Review beside the manuscript">
                    Select a thread to reveal and highlight its location in Source or Visual. Use filters to separate comments from suggestions, and use For you for discussions you joined or were mentioned in.
                  </HelpItem>
                  <HelpItem icon={GitPullRequest} title="Create a deliberate record">
                    A maintainer saves a snapshot when the team is ready. That updates the room branch and draft pull request, where repository CI remains the authoritative publication check.
                  </HelpItem>
                </div>
                <div className="help-callout">
                  <strong>A practical first pass</strong>
                  <ol>
                    <li>Choose Source, Split, or Visual for the task at hand.</li>
                    <li>Write directly when you have editing access; use Suggesting when changes need individual approval.</li>
                    <li>Resolve comments and accept or reject proposals before saving the next GitHub snapshot.</li>
                  </ol>
                </div>
              </>
            )}

            {activeTopic === 'editing' && (
              <>
                <TopicHeader title="Choose the right writing surface">
                  Source and Visual edit the same shared manuscript. Switch views without creating a second copy of the document.
                </TopicHeader>
                <div className="help-guide-list">
                  <HelpItem icon={Code2} title="Source">
                    Edit exact MyST Markdown, directives, citations, and frontmatter. This is the clearest view for structural changes and precise review anchors.
                  </HelpItem>
                  <HelpItem icon={Eye} title="Visual">
                    Read the rendered manuscript and edit supported text blocks in place. The browser rendering is a fast authoring aid; the repository publication build remains authoritative.
                  </HelpItem>
                  <HelpItem icon={BookOpenText} title="Split">
                    Keep Source and Visual visible together. The panes scroll independently so you can compare structure and rendering without losing your position.
                  </HelpItem>
                  <HelpItem icon={CheckCircle2} title="Editing and Suggesting">
                    Editing changes the live draft directly. Suggesting creates attributed proposals that a maintainer accepts or rejects one at a time; accepted proposals become part of the live draft.
                  </HelpItem>
                </div>
              </>
            )}

            {activeTopic === 'review' && (
              <>
                <TopicHeader title="Keep discussion attached to the work">
                  Review threads are compact on purpose: the manuscript shows the full proposed change, while the sidebar carries the conversation and decision.
                </TopicHeader>
                <div className="help-guide-list">
                  <HelpItem icon={MessageSquareText} title="Comments and replies">
                    Select Source text before adding a comment to anchor the discussion. Only an author can edit their own message; everyone with editing or suggesting access can reply.
                  </HelpItem>
                  <HelpItem icon={UsersRound} title="Mentions and For you">
                    Type @ in a reply and choose a participant. The thread then appears in that person's For you inbox when they use the same document identity.
                  </HelpItem>
                  <HelpItem icon={CheckCircle2} title="Suggested changes">
                    Insert, Delete, and Replace summaries stay short in the sidebar. Select one to inspect the full highlighted proposal in the manuscript, then accept or reject it from the active thread.
                  </HelpItem>
                  <HelpItem icon={Radio} title="Sync state">
                    Queued for maintainer or Queued for PR appears once for the whole thread. A Retry sync action identifies the individual message that needs attention.
                  </HelpItem>
                </div>
              </>
            )}

            {activeTopic === 'publish' && (
              <>
                <TopicHeader title="Control access and the GitHub handoff">
                  Live collaboration and repository publication are connected, but they are intentionally separate decisions.
                </TopicHeader>
                <div className="help-guide-list">
                  <HelpItem icon={Share2} title="Share by responsibility">
                    Editor links can change the live draft and manage snapshots. Suggestion links can propose and discuss changes. Viewer links are read-only. Revoked or expired links stop editing immediately.
                  </HelpItem>
                  <HelpItem icon={GitPullRequest} title="Save a snapshot">
                    A maintainer's Save to GitHub action writes the accepted room state to its branch and updates the draft pull request. It does not silently publish the manuscript.
                  </HelpItem>
                  <HelpItem icon={CheckCircle2} title="Use CI as the publication gate">
                    Repository tests, MyST build settings, plugins, styles, and interactive figures are evaluated outside the lightweight browser preview. Merge only after the protected checks pass.
                  </HelpItem>
                </div>
              </>
            )}

            {activeTopic === 'shortcuts' && (
              <>
                <TopicHeader title="Keyboard shortcuts">
                  These shortcuts work across supported macOS, Windows, and Linux browsers. Use Command on macOS and Control elsewhere.
                </TopicHeader>
                <table className="help-shortcuts">
                  <tbody>
                    <tr><th scope="row">Add a comment</th><td><kbd>Command / Ctrl</kbd> + <kbd>Option / Alt</kbd> + <kbd>M</kbd></td></tr>
                    <tr><th scope="row">Submit a comment or reply</th><td><kbd>Command / Ctrl</kbd> + <kbd>Enter</kbd></td></tr>
                    <tr><th scope="row">Save a Visual text edit</th><td><kbd>Command / Ctrl</kbd> + <kbd>Enter</kbd></td></tr>
                    <tr><th scope="row">Bold / italic in a Visual text edit</th><td><kbd>Command / Ctrl</kbd> + <kbd>B</kbd> / <kbd>I</kbd></td></tr>
                    <tr><th scope="row">Choose a mention</th><td><kbd>Arrow up / down</kbd> + <kbd>Enter</kbd></td></tr>
                    <tr><th scope="row">Undo / redo</th><td><kbd>Command / Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Shift</kbd> + <kbd>Z</kbd></td></tr>
                    <tr><th scope="row">Open a focused review thread</th><td><kbd>Enter</kbd> or <kbd>Space</kbd></td></tr>
                    <tr><th scope="row">Close the current menu or dialog</th><td><kbd>Escape</kbd></td></tr>
                  </tbody>
                </table>
              </>
            )}

            {activeTopic === 'about' && (
              <>
                <TopicHeader title="About DeMystify">
                  DeMystify is an open collaborative authoring environment for MyST manuscripts, combining Yjs live editing with deliberate GitHub snapshots and pull-request review.
                </TopicHeader>
                <dl className="help-versions">
                  <div><dt>DeMystify</dt><dd>{__DEMYSTIFY_VERSION__}</dd></div>
                  <div><dt>Build revision</dt><dd>{__BUILD_REVISION__}</dd></div>
                  <div><dt>MyST parser</dt><dd>{__MYST_PARSER_VERSION__}</dd></div>
                  <div><dt>Yjs collaboration</dt><dd>{__YJS_VERSION__}</dd></div>
                  <div><dt>React interface</dt><dd>{__REACT_VERSION__}</dd></div>
                </dl>
                <div className="help-about-note">
                  <strong>Design principle</strong>
                  <p>The live room optimizes for close collaboration; GitHub preserves deliberate history, review, and reproducible publication.</p>
                  <a href="https://github.com/AllenNeuralDynamics/demystify" target="_blank" rel="noreferrer">
                    Open the source repository
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
