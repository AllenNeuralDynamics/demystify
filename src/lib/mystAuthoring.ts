import {
  snippetCompletion,
  type Completion,
  type CompletionSource,
} from '@codemirror/autocomplete'

export const mystAuthoringCategories = [
  'Document',
  'Callouts',
  'References',
  'Media',
] as const

export type MystAuthoringCategory = (typeof mystAuthoringCategories)[number]

export type MystAuthoringIcon =
  | 'heading'
  | 'figure'
  | 'table'
  | 'equation'
  | 'code'
  | 'note'
  | 'tip'
  | 'warning'
  | 'dropdown'
  | 'tabs'
  | 'citation'
  | 'reference'
  | 'iframe'

interface MystRegistryMetadata {
  kind: 'directive' | 'role'
  name: string
}

export interface MystAuthoringPattern {
  id: string
  label: string
  description: string
  category: MystAuthoringCategory
  icon: MystAuthoringIcon
  keywords: string[]
  syntaxLabel: string
  template: string
  selectedTextPlaceholder?: string
  registry?: MystRegistryMetadata
}

const block = (...lines: string[]) => lines.join('\n')

const registryMetadata = (
  kind: MystRegistryMetadata['kind'],
  name: string,
): MystRegistryMetadata => ({ kind, name })

const directive = (
  name: string,
  pattern: Omit<MystAuthoringPattern, 'registry'>,
): MystAuthoringPattern => ({
  ...pattern,
  registry: registryMetadata('directive', name),
})

const role = (
  name: string,
  pattern: Omit<MystAuthoringPattern, 'registry'>,
): MystAuthoringPattern => ({
  ...pattern,
  registry: registryMetadata('role', name),
})

export const mystAuthoringPatterns: MystAuthoringPattern[] = [
  {
    id: 'heading',
    label: 'Section heading',
    description: 'Start a new manuscript section',
    category: 'Document',
    icon: 'heading',
    keywords: ['heading', 'section', 'title', 'markdown'],
    syntaxLabel: '## Heading',
    template: '## ${1:Section title}\n${0}',
    selectedTextPlaceholder: '${1:Section title}',
  },
  directive('figure', {
    id: 'figure',
    label: 'Figure',
    description: 'Captioned image with a reference label',
    category: 'Document',
    icon: 'figure',
    keywords: ['figure', 'image', 'caption', 'label', 'scientific'],
    syntaxLabel: ':::{figure}',
    template: block(
      ':::{figure} ${1:path/to/image.png}',
      ':label: ${2:fig-label}',
      ':alt: ${3:Accessible description}',
      ':width: ${4:80%}',
      '',
      '${5:Figure caption.}',
      ':::',
      '${0}',
    ),
  }),
  directive('table', {
    id: 'table',
    label: 'Table',
    description: 'Captioned table with a reference label',
    category: 'Document',
    icon: 'table',
    keywords: ['table', 'data', 'caption', 'label', 'columns'],
    syntaxLabel: ':::{table}',
    template: block(
      ':::{table} ${1:Table caption.}',
      ':label: ${2:tbl-label}',
      '',
      '| ${3:Column 1} | ${4:Column 2} |',
      '| --- | --- |',
      '| ${5:Value} | ${6:Value} |',
      ':::',
      '${0}',
    ),
  }),
  directive('math', {
    id: 'equation',
    label: 'Equation',
    description: 'Numbered display math that can be referenced',
    category: 'Document',
    icon: 'equation',
    keywords: ['equation', 'math', 'latex', 'label'],
    syntaxLabel: ':::{math}',
    template: block(
      ':::{math}',
      ':label: ${1:eq-label}',
      '',
      '${2:y = mx + b}',
      ':::',
      '${0}',
    ),
    selectedTextPlaceholder: '${2:y = mx + b}',
  }),
  directive('code', {
    id: 'code',
    label: 'Code block',
    description: 'Highlighted source with caption and line numbers',
    category: 'Document',
    icon: 'code',
    keywords: ['code', 'source', 'python', 'typescript', 'caption'],
    syntaxLabel: ':::{code}',
    template: block(
      ':::{code} ${1:python}',
      ':caption: ${2:Code caption}',
      ':linenos:',
      '',
      '${3:print("Hello, world!")}',
      ':::',
      '${0}',
    ),
    selectedTextPlaceholder: '${3:print("Hello, world!")}',
  }),
  directive('note', {
    id: 'note',
    label: 'Note',
    description: 'Neutral supporting context',
    category: 'Callouts',
    icon: 'note',
    keywords: ['note', 'callout', 'admonition', 'info'],
    syntaxLabel: ':::{note}',
    template: block(
      ':::{note} ${1:Note}',
      '${2:Supporting context.}',
      ':::',
      '${0}',
    ),
    selectedTextPlaceholder: '${2:Supporting context.}',
  }),
  directive('tip', {
    id: 'tip',
    label: 'Tip',
    description: 'Helpful recommendation or insight',
    category: 'Callouts',
    icon: 'tip',
    keywords: ['tip', 'hint', 'callout', 'admonition'],
    syntaxLabel: ':::{tip}',
    template: block(
      ':::{tip} ${1:Tip}',
      '${2:Helpful context.}',
      ':::',
      '${0}',
    ),
    selectedTextPlaceholder: '${2:Helpful context.}',
  }),
  directive('warning', {
    id: 'warning',
    label: 'Warning',
    description: 'Important caveat or risk',
    category: 'Callouts',
    icon: 'warning',
    keywords: ['warning', 'caution', 'danger', 'callout', 'admonition'],
    syntaxLabel: ':::{warning}',
    template: block(
      ':::{warning} ${1:Warning}',
      '${2:Important caveat.}',
      ':::',
      '${0}',
    ),
    selectedTextPlaceholder: '${2:Important caveat.}',
  }),
  directive('dropdown', {
    id: 'dropdown',
    label: 'Dropdown',
    description: 'Collapsible supporting material',
    category: 'Callouts',
    icon: 'dropdown',
    keywords: ['dropdown', 'collapse', 'details', 'supplement'],
    syntaxLabel: ':::{dropdown}',
    template: block(
      ':::{dropdown} ${1:Details}',
      '${2:Collapsible content.}',
      ':::',
      '${0}',
    ),
    selectedTextPlaceholder: '${2:Collapsible content.}',
  }),
  role('cite:p', {
    id: 'citation',
    label: 'Citation',
    description: 'Parenthetical reference to a BibTeX entry',
    category: 'References',
    icon: 'citation',
    keywords: ['citation', 'cite', 'bibtex', 'reference', 'doi'],
    syntaxLabel: '{cite:p}`key`',
    template: '{cite:p}`${1:citation-key}`${0}',
  }),
  role('ref', {
    id: 'reference',
    label: 'Cross-reference',
    description: 'Link to a labeled figure, table, or equation',
    category: 'References',
    icon: 'reference',
    keywords: ['reference', 'cross-reference', 'link', 'label', 'figure'],
    syntaxLabel: '{ref}`label`',
    template: '{ref}`${1:label}`${0}',
  }),
  {
    id: 'tabs',
    label: 'Tabs',
    description: 'Switchable views for parallel content',
    category: 'Media',
    icon: 'tabs',
    keywords: ['tabs', 'tab-set', 'tab-item', 'layout', 'compare'],
    syntaxLabel: '::::{tab-set}',
    template: block(
      '::::{tab-set}',
      ':::{tab-item} ${1:First tab}',
      '${2:First tab content.}',
      ':::',
      '',
      ':::{tab-item} ${3:Second tab}',
      '${4:Second tab content.}',
      ':::',
      '::::',
      '${0}',
    ),
    selectedTextPlaceholder: '${2:First tab content.}',
  },
  directive('iframe', {
    id: 'iframe',
    label: 'Interactive embed',
    description: 'Iframe with accessible title and fallback caption',
    category: 'Media',
    icon: 'iframe',
    keywords: ['iframe', 'embed', 'video', 'interactive', 'url'],
    syntaxLabel: ':::{iframe}',
    template: block(
      ':::{iframe} ${1:https://example.org/embed}',
      ':title: ${2:Interactive content title}',
      ':width: ${3:100%}',
      '',
      '${4:Interactive content caption.}',
      ':::',
      '${0}',
    ),
  }),
]

const escapeSnippetText = (value: string) => value.replace(/[{}]/g, '\\$&')

export const fillSnippetSelection = (
  template: string,
  placeholder: string | undefined,
  selectedText: string,
) => placeholder && selectedText
  ? template.replace(placeholder, escapeSnippetText(selectedText))
  : template

const completionType: Record<MystAuthoringCategory, Completion['type']> = {
  Document: 'keyword',
  Callouts: 'type',
  References: 'variable',
  Media: 'function',
}

export const mystAuthoringCompletions: Completion[] = mystAuthoringPatterns.map(
  (pattern) => snippetCompletion(pattern.template, {
    label: pattern.id,
    displayLabel: pattern.label,
    detail: pattern.syntaxLabel,
    info: pattern.description,
    section: pattern.category,
    type: completionType[pattern.category],
  }),
)

export const mystAuthoringCompletionSource: CompletionSource = (context) => {
  if (!context.explicit) return null
  const word = context.matchBefore(/[\w-]*$/)
  return {
    from: word?.from ?? context.pos,
    options: mystAuthoringCompletions,
    validFor: /^[\w-]*$/,
  }
}