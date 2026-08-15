import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  getActiveMention,
  insertMention,
  type ActiveMention,
  type MentionCandidate,
} from '../lib/mentions'

interface MentionInputProps {
  ariaLabel: string
  candidates: MentionCandidate[]
  disabled?: boolean
  placeholder: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}

export const MentionInput = ({
  ariaLabel,
  candidates,
  disabled = false,
  placeholder,
  value,
  onChange,
  onSubmit,
}: MentionInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null)
  const [activeOption, setActiveOption] = useState(0)
  const matchingCandidates = useMemo(() => {
    if (!activeMention) return []
    const query = activeMention.query.trim().toLocaleLowerCase()
    return candidates
      .filter((candidate) => [candidate.name, candidate.displayName]
        .some((value) => value?.toLocaleLowerCase().includes(query)))
      .slice(0, 6)
  }, [activeMention, candidates])
  const menuOpen = matchingCandidates.length > 0

  const updateActiveMention = (nextValue: string, caret: number | null) => {
    setActiveMention(caret === null ? null : getActiveMention(nextValue, caret))
    setActiveOption(0)
  }

  const chooseCandidate = (candidate: MentionCandidate) => {
    if (!activeMention) return
    const next = insertMention(value, activeMention, candidate)
    onChange(next.value)
    setActiveMention(null)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (menuOpen && event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveOption((current) => (current + 1) % matchingCandidates.length)
      return
    }
    if (menuOpen && event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveOption((current) =>
        (current - 1 + matchingCandidates.length) % matchingCandidates.length)
      return
    }
    if (menuOpen && (event.key === 'Enter' || event.key === 'Tab') &&
      !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      chooseCandidate(matchingCandidates[activeOption])
      return
    }
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault()
      setActiveMention(null)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      setActiveMention(null)
      onSubmit()
    }
  }

  return (
    <div className="mention-input">
      <input
        aria-activedescendant={menuOpen ? `${listboxId}-${activeOption}` : undefined}
        aria-autocomplete="list"
        aria-controls={menuOpen ? listboxId : undefined}
        aria-expanded={menuOpen}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        value={value}
        onBlur={() => setActiveMention(null)}
        onChange={(event) => {
          onChange(event.target.value)
          updateActiveMention(event.target.value, event.target.selectionStart)
        }}
        onClick={(event) => updateActiveMention(value, event.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
      />
      {menuOpen && (
        <div className="mention-options" id={listboxId} role="listbox">
          {matchingCandidates.map((candidate, index) => (
            <button
              aria-selected={index === activeOption}
              className="mention-option"
              id={`${listboxId}-${index}`}
              key={candidate.actorId}
              role="option"
              tabIndex={-1}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                chooseCandidate(candidate)
              }}
            >
              <span
                aria-hidden="true"
                className="mention-option-avatar"
                style={{ background: candidate.colorLight, color: candidate.color }}
              >
                {candidate.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="mention-option-identity">
                <strong>{candidate.displayName ?? candidate.name}</strong>
                {candidate.displayName && candidate.displayName !== candidate.name && (
                  <small>@{candidate.name}</small>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}