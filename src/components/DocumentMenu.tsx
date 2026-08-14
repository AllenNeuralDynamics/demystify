import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

export interface DocumentMenuItem {
  label: string
  icon?: LucideIcon
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

interface DocumentMenuProps {
  align?: 'left' | 'right'
  className?: string
  disabled?: boolean
  icon?: LucideIcon
  items: DocumentMenuItem[]
  label: string
  showChevron?: boolean
}

export const DocumentMenu = ({
  align = 'left',
  className = '',
  disabled = false,
  icon: TriggerIcon,
  items,
  label,
  showChevron = false,
}: DocumentMenuProps) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return

    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [open])

  const focusMenuItem = (position: 'first' | 'last') => {
    window.requestAnimationFrame(() => {
      const available = Array.from(
        containerRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [],
      )
      available[position === 'first' ? 0 : available.length - 1]?.focus()
    })
  }

  const moveMenuFocus = (event: React.KeyboardEvent, direction: 1 | -1) => {
    const available = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [],
    )
    if (available.length === 0) return
    const activeIndex = available.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = activeIndex < 0
      ? direction > 0 ? 0 : available.length - 1
      : (activeIndex + direction + available.length) % available.length
    event.preventDefault()
    available[nextIndex].focus()
  }

  return (
    <div className={`document-menu align-${align} ${className}`.trim()} ref={containerRef}>
      <button
        ref={triggerRef}
        className={`document-menu-trigger ${open ? 'active' : ''}`}
        type="button"
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
          focusMenuItem(event.key === 'ArrowDown' ? 'first' : 'last')
        }}
      >
        {TriggerIcon && <TriggerIcon size={15} />}
        <span className="document-menu-trigger-label">{label}</span>
        {showChevron && <ChevronDown className="document-menu-chevron" size={13} />}
      </button>
      {open && (
        <div
          className="document-menu-popover"
          id={menuId}
          role="menu"
          aria-label={`${label} menu`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') moveMenuFocus(event, 1)
            if (event.key === 'ArrowUp') moveMenuFocus(event, -1)
            if (event.key === 'Home') {
              event.preventDefault()
              focusMenuItem('first')
            }
            if (event.key === 'End') {
              event.preventDefault()
              focusMenuItem('last')
            }
          }}
        >
          {items.map((item) => {
            const ItemIcon = item.icon
            return (
              <button
                className={item.separatorBefore ? 'separator-before' : ''}
                key={item.label}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span className="document-menu-check" aria-hidden="true">
                  {item.checked ? <Check size={14} /> : null}
                </span>
                {ItemIcon ? <ItemIcon size={15} /> : <span className="document-menu-icon" />}
                <span className="document-menu-label">{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}