// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { joinBackward, splitBlockAs } from 'prosemirror-commands'
import * as Y from 'yjs'
import { applyVisualSourceChanges } from './visualCollaboration'
import { createCommentAnchor, resolveCommentAnchor } from './commentAnchors'
import { renderMyst } from './myst'
import {
  createVisualDocument,
  getVisualDocumentChanges,
  serializeVisualBlock,
  serializeVisualDocument,
  sourcePositionToVisual,
  visualPositionToSource,
  visualDocumentSchema,
  visualNodeSourceRange,
} from './visualDocument'

describe('continuous visual document', () => {
  it('maps mounted figure and nested object ranges to their complete source', () => {
    const source = '# Draft\n\nBefore.\n\n(figure-label)=\n\n' +
      ':::{figure} /image.png\n:name: fig-mounted\n\nCaption with $x^2$.\n:::\n\n' +
      ':::{note}\nNested prose.\n\n$$\ny^3\n$$\n:::\n\nAfter.'
    const model = createVisualDocument(source)
    model.descendants((node, position) => {
      if (!node.isTextblock && node.type.name !== 'myst_container' && node.type.name !== 'protected_block') return
      const range = visualNodeSourceRange(model, position)
      expect(range).not.toBeNull()
      expect(source.slice(range!.from, range!.to)).toBe(serializeVisualBlock(node))
    })
    expect(serializeVisualDocument(model)).toBe(source)
  })

  it('keeps labeled equation previews paired with their exact source', () => {
    const source = '(first-equation)=\n\n$$\na^2\n$$\n\n' +
      '(second-equation)=\n\n$$\nb^3\n$$\n\n' +
      'A paragraph with $c^4$.\n\n(unrendered-label)=\n\nFinal paragraph.'
    const model = createVisualDocument(source)
    const equations: Array<{ source: string; html: string }> = []
    model.descendants((node) => {
      if (node.type.name !== 'protected_block') return
      const element = document.createElement('div')
      element.innerHTML = node.attrs.html
      const math = element.querySelector('.math-display')
      if (math) {
        equations.push({ source: node.attrs.source, html: math.textContent ?? '' })
        expect(node.attrs.source).toContain(math.textContent)
      }
    })
    expect(equations).toHaveLength(2)
    expect(equations[0]).toMatchObject({ source: '$$\na^2\n$$', html: 'a^2' })
    expect(equations[1]).toMatchObject({ source: '$$\nb^3\n$$', html: 'b^3' })
    expect(serializeVisualDocument(model)).toBe(source)
  })

  it('keeps protected paragraph formulas attached to their own prose', () => {
    const source = 'First paragraph with $x^2$.\n\n' +
      ':::{note}\nNested paragraph with $y^3$.\n:::\n\n' +
      '> Quoted paragraph with $z^4$.\n\n' +
      '$F_1$ **Score**: the harmonic mean of precision and recall.\n\n' +
      'Another condition $SNR > \\theta$.\n'
    const model = createVisualDocument(source)
    model.descendants((node) => {
      if (node.type.name !== 'protected_block') return
      const element = document.createElement('div')
      element.innerHTML = node.attrs.html
      for (const math of Array.from(element.querySelectorAll('.math-inline, .math-display'))) {
        expect(node.attrs.source).toContain(math.textContent)
      }
    })
    expect(serializeVisualDocument(model)).toBe(source)
  })

  it('uses document-wide figure numbers, cross-references and bibliography rendering', () => {
    const source = ':::{figure} first.svg\n:name: fig-first\n\nFirst caption.\n:::\n\n' +
      ':::{figure} second.svg\n:name: fig-second\n\nSecond caption.\n:::\n\n' +
      'See {numref}`fig-second`.\n\nA model $x = 2$ {cite:p}`smith2024`.\n'
    const bibliography = '@article{smith2024, title={A paper}, author={Smith, Ada}, year={2024}}'
    const expected = document.createElement('div')
    expected.innerHTML = renderMyst(source, { bibliography }).html
    const model = createVisualDocument(source, { bibliography })
    const actual = document.createElement('div')
    model.descendants((node) => {
      if (node.type.name === 'myst_container' || node.type.name === 'protected_block') {
        actual.insertAdjacentHTML('beforeend', node.attrs.html)
        return false
      }
    })
    actual.insertAdjacentHTML('beforeend', model.attrs.appendixHtml)
    expect(Array.from(actual.querySelectorAll('.caption-number'), (element) => element.textContent))
      .toEqual(Array.from(expected.querySelectorAll('.caption-number'), (element) => element.textContent))
    expect(Array.from(actual.querySelectorAll('.myst-reference'), (element) => element.textContent))
      .toEqual(Array.from(expected.querySelectorAll('.myst-reference'), (element) => element.textContent))
    expect(actual.textContent).toContain('Smith')
    expect(serializeVisualDocument(model)).toBe(source)
  })

  it('keeps nested note, list and quotation prose editable without changing their MyST wrappers', () => {
    const source = ':::{note}\nFirst note.\n\nSecond note.\n:::\n\n- First item\n- Second item\n\n> A quotation.\n'
    const document = createVisualDocument(source)
    expect(document.firstChild?.type.name).toBe('myst_container')
    expect(document.firstChild?.childCount).toBe(2)
    expect(document.child(1).type.name).toBe('bullet_list')
    expect(document.lastChild?.type.name).toBe('blockquote')
    expect(serializeVisualDocument(document)).toBe(source)
    const state = EditorState.create({ doc: document })
    const position = sourcePositionToVisual(document, source.indexOf('Second note.') + 6)
    const updated = state.apply(state.tr.insertText('editable ', position)).doc
    expect(serializeVisualDocument(updated)).toBe(source.replace('Second note.', 'Secondeditable  note.'))
    expect(visualPositionToSource(document, position)).toBe(source.indexOf('Second note.') + 6)
  })

  it('maps formatted positions through Markdown formatting and paragraph boundaries', () => {
    const source = '# Heading\n\nA **bold** result.\n\nNext paragraph.'
    const document = createVisualDocument(source)
    for (const term of ['Heading', 'bold', 'result', 'Next', 'paragraph']) {
      const sourcePosition = source.indexOf(term)
      expect(visualPositionToSource(document, sourcePositionToVisual(document, sourcePosition)))
        .toBe(sourcePosition)
    }
  })

  it('merges simultaneous same-paragraph edits without replacing collaborators text', () => {
    const first = new Y.Doc()
    const second = new Y.Doc()
    const original = 'One shared paragraph remains inspectable.'
    const firstText = first.getText('content')
    firstText.insert(0, original)
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first))
    const secondText = second.getText('content')
    const anchor = createCommentAnchor(firstText, original.indexOf('inspectable'), original.length - 1)
    const sharedVersion = Y.encodeStateVector(first)
    expect(applyVisualSourceChanges(firstText, original,
      original.replace('One', 'One continuously edited'), 'visual')).toBe(true)
    secondText.insert(original.indexOf('shared'), 'collaboratively ')
    const firstUpdate = Y.encodeStateAsUpdate(first, sharedVersion)
    const secondUpdate = Y.encodeStateAsUpdate(second, sharedVersion)
    Y.applyUpdate(first, secondUpdate)
    Y.applyUpdate(second, firstUpdate)
    expect(firstText.toString()).toBe(secondText.toString())
    expect(firstText.toString()).toContain('continuously edited')
    expect(firstText.toString()).toContain('collaboratively ')
    expect(firstText.toString()).toContain('shared paragraph remains inspectable.')
    const range = resolveCommentAnchor(first, firstText, anchor)
    expect(firstText.toString().slice(range!.from, range!.to)).toBe('inspectable')
    first.destroy()
    second.destroy()
  })

  it('refuses to overwrite a newer shared source and keeps undo local to its editor', () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Shared text.')
    const origin = {}
    const undo = new Y.UndoManager(text, { trackedOrigins: new Set([origin]) })
    expect(applyVisualSourceChanges(text, 'Shared text.', 'Shared Visual text.', origin)).toBe(true)
    document.transact(() => text.insert(text.length, ' Remote.'), 'remote')
    expect(applyVisualSourceChanges(text, 'Shared text.', 'Stale text.', origin)).toBe(false)
    undo.undo()
    expect(text.toString()).toBe('Shared text. Remote.')
    undo.destroy()
    document.destroy()
  })

  it('preserves unmodified MyST and protected scientific blocks byte for byte', () => {
    const source = '# Heading ##\n\nA _formatted_ paragraph.\n\n:::{note}\nPreserved note.\n:::\n\n' +
      '$$\nx = 2\n$$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nFinal paragraph.\n'
    const document = createVisualDocument(source)
    expect(serializeVisualDocument(document)).toBe(source)
    expect(document.firstChild?.type.name).toBe('heading')
    expect(document.firstChild?.textContent).toBe('Heading')
    expect(document.child(1).textContent).toBe('A formatted paragraph.')
    expect(document.lastChild?.textContent).toBe('Final paragraph.')
  })

  it('inserts in one paragraph without rewriting other paragraphs', () => {
    const source = '# Heading\n\nFirst paragraph.\n\nSecond _paragraph_.\n'
    const document = createVisualDocument(source)
    const state = EditorState.create({ doc: document })
    const updated = state.apply(state.tr.insertText('new ', 15)).doc
    const result = serializeVisualDocument(updated)
    expect(result).toBe('# Heading\n\nFirstnew  paragraph.\n\nSecond _paragraph_.\n')
    expect(getVisualDocumentChanges(source, result))
      .toEqual([{ from: 16, to: 16, before: '', after: 'new ' }])
  })

  it('splits and joins paragraphs through the standard editor commands', () => {
    let state = EditorState.create({ doc: createVisualDocument('First second.') })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)))
    const split = splitBlockAs(() => ({ type: visualDocumentSchema.nodes.paragraph }))
    expect(split(state, (transaction) => { state = state.apply(transaction) })).toBe(true)
    expect(serializeVisualDocument(state.doc)).toBe('First\n\n second.')
    expect(joinBackward(state, (transaction) => { state = state.apply(transaction) })).toBe(true)
    expect(serializeVisualDocument(state.doc)).toBe('First second.')
  })

  it('represents separate modifications as separate incremental source changes', () => {
    expect(getVisualDocumentChanges('First.\n\nSecond.\n\nThird.', 'FIRST.\n\nSecond.\n\nTHIRD.'))
      .toEqual([
        { from: 1, to: 5, before: 'irst', after: 'IRST' },
        { from: 18, to: 22, before: 'hird', after: 'HIRD' },
      ])
  })
})