import {
  AtSign,
  ChevronDown,
  ChevronsUpDown,
  Code2,
  Heading2,
  Image,
  Info,
  Lightbulb,
  Link2,
  MessageSquareText,
  MonitorPlay,
  PanelsTopLeft,
  Plus,
  Search,
  Sigma,
  Table2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  mystAuthoringCategories,
  mystAuthoringPatterns,
  type MystAuthoringIcon,
  type MystAuthoringPattern,
} from '../lib/mystAuthoring'

interface MystInsertMenuProps {
  disabled?: boolean
  onAddComment?: () => void
  onInsert: (pattern: MystAuthoringPattern) => void
}

const patternIcons: Record<MystAuthoringIcon, LucideIcon> = {
  heading: Heading2,
  figure: Image,
  table: Table2,
  equation: Sigma,
  code: Code2,
  note: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
  dropdown: ChevronsUpDown,
  tabs: PanelsTopLeft,
  citation: AtSign,
  reference: Link2,
  iframe: MonitorPlay,
}

export const MystInsertMenu = ({
  disabled = false,
  onAddComment,
  onInsert,
}: MystInsertMenuProps) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return

    searchRef.current?.focus()
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      setQuery('')
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const visiblePatterns = normalizedQuery
    ? mystAuthoringPatterns.filter((pattern) => [
      pattern.label,
      pattern.description,
      pattern.syntaxLabel,
      ...pattern.keywords,
    ].join(' ').toLowerCase().includes(normalizedQuery))
    : mystAuthoringPatterns
  const showCommentAction = Boolean(onAddComment) && (
    !normalizedQuery || 'add comment review selection discussion'.includes(normalizedQuery)
  )

  const moveListFocus = (event: React.KeyboardEvent, direction: 1 | -1) => {
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-myst-pattern], [data-insert-action]') ?? [],
    )
    if (items.length === 0) return
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = activeIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : (activeIndex + direction + items.length) % items.length
    event.preventDefault()
    items[nextIndex].focus()
  }

  const insertPattern = (pattern: MystAuthoringPattern) => {
    setOpen(false)
    setQuery('')
    onInsert(pattern)
  }

  const addComment = () => {
    setOpen(false)
    setQuery('')
    onAddComment?.()
  }

  return (
    <div className="myst-insert-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`myst-insert-trigger ${open ? 'active' : ''}`}
        type="button"
        title="Insert MyST content"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="myst-insert-palette"
        disabled={disabled}
        onClick={() => {
          if (open) setQuery('')
          setOpen((current) => !current)
        }}
      >
        <Plus size={16} />
        <span>Insert</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div
          id="myst-insert-palette"
          className="myst-insert-palette"
          role="dialog"
          aria-label="Insert MyST content"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') moveListFocus(event, 1)
            if (event.key === 'ArrowUp') moveListFocus(event, -1)
          }}
        >
          <label className="myst-insert-search">
            <Search size={15} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search content types"
              aria-label="Search content types"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="myst-insert-results">
            {showCommentAction && (
              <section className="myst-insert-group" aria-labelledby="myst-group-review">
                <h3 id="myst-group-review">Review</h3>
                <button
                  className="myst-pattern-command"
                  type="button"
                  data-insert-action="comment"
                  onClick={addComment}
                >
                  <span className="myst-pattern-icon note">
                    <MessageSquareText size={16} />
                  </span>
                  <span className="myst-pattern-copy">
                    <strong>Add comment to selection</strong>
                    <small>Open Review and anchor a discussion to selected Source text.</small>
                  </span>
                  <code>⌘⌥M</code>
                </button>
              </section>
            )}
            {mystAuthoringCategories.map((category) => {
              const patterns = visiblePatterns.filter((pattern) => pattern.category === category)
              if (patterns.length === 0) return null
              return (
                <section className="myst-insert-group" key={category} aria-labelledby={`myst-group-${category}`}>
                  <h3 id={`myst-group-${category}`}>{category}</h3>
                  {patterns.map((pattern) => {
                    const PatternIcon = patternIcons[pattern.icon]
                    return (
                      <button
                        key={pattern.id}
                        className="myst-pattern-command"
                        type="button"
                        data-myst-pattern={pattern.id}
                        onClick={() => insertPattern(pattern)}
                      >
                        <span className={`myst-pattern-icon ${pattern.icon}`}>
                          <PatternIcon size={16} />
                        </span>
                        <span className="myst-pattern-copy">
                          <strong>{pattern.label}</strong>
                          <small>{pattern.description}</small>
                        </span>
                        <code>{pattern.syntaxLabel}</code>
                      </button>
                    )
                  })}
                </section>
              )
            })}
            {visiblePatterns.length === 0 && !showCommentAction && (
              <p className="myst-insert-empty">No matching content types</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}