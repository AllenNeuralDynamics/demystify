import { Bold, Code2, Italic, Redo2, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'

export interface EditorCommandState {
  canUndo: boolean
  canRedo: boolean
  blocked: boolean
}

interface EditorPaneToolbarProps {
  name: 'Source' | 'Visual'
  disabled: boolean
  canUndo: boolean
  canRedo: boolean
  formatting?: boolean
  onUndo: () => void
  onRedo: () => void
  onFormat: (marker: '**' | '*' | '`') => void
  onActivate?: () => void
  children?: ReactNode
}

export const EditorPaneToolbar = ({ name, disabled, canUndo, canRedo, formatting = true,
  onUndo, onRedo, onFormat, onActivate, children }: EditorPaneToolbarProps) => (
  <div className="visual-inline-toolbar editor-pane-toolbar" role="toolbar" aria-label={`${name} editing tools`}
    onFocusCapture={onActivate} onMouseDown={(event) => { onActivate?.(); event.preventDefault() }}>
    <button type="button" title="Undo" aria-label={`Undo in ${name}`} disabled={disabled || !canUndo} onClick={onUndo}><Undo2 size={15} /></button>
    <button type="button" title="Redo" aria-label={`Redo in ${name}`} disabled={disabled || !canRedo} onClick={onRedo}><Redo2 size={15} /></button>
    <span className="toolbar-divider" />
    <button type="button" title="Bold" aria-label={`Bold in ${name}`} disabled={disabled || !formatting} onClick={() => onFormat('**')}><Bold size={15} /></button>
    <button type="button" title="Italic" aria-label={`Italic in ${name}`} disabled={disabled || !formatting} onClick={() => onFormat('*')}><Italic size={15} /></button>
    <button type="button" title="Inline code" aria-label={`Inline code in ${name}`} disabled={disabled || !formatting} onClick={() => onFormat('`')}><Code2 size={15} /></button>
    {children}
  </div>
)