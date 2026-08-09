// @vitest-environment jsdom
import { CompletionContext, snippet } from '@codemirror/autocomplete'
import { EditorState, type Transaction } from '@codemirror/state'
import { defaultDirectives } from 'myst-directives'
import { defaultRoles } from 'myst-roles'
import { describe, expect, it } from 'vitest'
import { renderMyst } from './myst'
import {
  fillSnippetSelection,
  mystAuthoringCompletionSource,
  mystAuthoringPatterns,
} from './mystAuthoring'

const instantiateSnippet = (template: string) => {
  const editor = {
    state: EditorState.create({ doc: '' }),
    dispatch(transaction: Transaction) {
      editor.state = transaction.state
    },
  }
  snippet(template)(editor, null, 0, 0)
  return editor.state.doc.toString()
}

const findRegistryEntry = (
  entries: { name: string; alias?: string[] }[],
  name: string,
) => entries.find((entry) => entry.name === name || entry.alias?.includes(name))

describe('MyST authoring patterns', () => {
  it('uses unique ids and verified MyST registry metadata', () => {
    const ids = mystAuthoringPatterns.map((pattern) => pattern.id)

    expect(new Set(ids).size).toBe(ids.length)
    mystAuthoringPatterns.forEach((pattern) => {
      if (!pattern.registry) return
      const entries = pattern.registry.kind === 'directive' ? defaultDirectives : defaultRoles
      expect(findRegistryEntry(entries, pattern.registry.name), pattern.label).toBeDefined()
    })
    expect(findRegistryEntry(defaultDirectives, 'note')?.name).toBe('admonition')
    expect(findRegistryEntry(defaultRoles, 'cite:p')?.name).toBe('cite')
  })

  it.each(mystAuthoringPatterns)('inserts and parses the $label pattern', (pattern) => {
    const source = instantiateSnippet(pattern.template)
    const result = renderMyst(source)

    expect(source).not.toMatch(/[#$]\{\d/)
    expect(result.error).toBeNull()
  })

  it('offers the shared patterns through explicit CodeMirror completion', () => {
    const state = EditorState.create({ doc: 'fig' })
    const result = mystAuthoringCompletionSource(new CompletionContext(state, 3, true))

    expect(result).not.toBeNull()
    expect(result).not.toBeInstanceOf(Promise)
    if (!result || result instanceof Promise) return
    expect(result.from).toBe(0)
    expect(result.options.some((completion) => completion.label === 'figure')).toBe(true)
  })

  it('preserves selected MyST and LaTeX source inside compatible blocks', () => {
    const note = mystAuthoringPatterns.find((pattern) => pattern.id === 'note')
    if (!note) throw new Error('Missing note pattern')
    const selectedText = 'Selected ${value} with \\frac{a}{b}.'
    const template = fillSnippetSelection(
      note.template,
      note.selectedTextPlaceholder,
      selectedText,
    )

    expect(instantiateSnippet(template)).toContain(selectedText)
  })
})