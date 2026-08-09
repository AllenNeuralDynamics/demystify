import { describe, expect, it } from 'vitest'
import {
  readMystMetadata,
  updatePageMystMetadata,
  updateProjectMystMetadata,
  validateMystMetadata,
} from './mystMetadata'

describe('MyST metadata', () => {
  it('updates page metadata while preserving unrelated YAML and manuscript source', () => {
    const source = `---
# Keep this comment
title: Original title
custom_field: untouched
authors:
  - id: ada
    name:
      given: Ada
      family: Lovelace
    github: ada
---

# Body
`
    const metadata = readMystMetadata(source, '')
    metadata.page.title = 'Revised title'
    metadata.page.authors[0].orcid = '0000-0002-1825-0097'
    metadata.page.authors[0].roles = ['Software']
    const updated = updatePageMystMetadata(source, metadata.page)

    expect(updated).toContain('# Keep this comment')
    expect(updated).toContain('custom_field: untouched')
    expect(updated).toContain('title: Revised title')
    expect(updated).toContain('given: Ada')
    expect(updated).toContain('github: ada')
    expect(updated).toContain('orcid: 0000-0002-1825-0097')
    expect(updated).toContain('- Software')
    expect(updated.endsWith('\n# Body\n')).toBe(true)
  })

  it('updates project metadata without rewriting site settings or comments', () => {
    const source = `version: 1
project:
  # Project title comment
  title: Original
  bibliography:
    - refs/library.bib
site:
  options:
    numbered_references: true
`
    const metadata = readMystMetadata('', source)
    metadata.project.title = 'Updated project'
    metadata.project.keywords = ['neuroscience', 'open science']
    const updated = updateProjectMystMetadata(source, metadata.project)

    expect(updated).toContain('# Project title comment')
    expect(updated).toContain('bibliography:\n    - refs/library.bib')
    expect(updated).toContain('numbered_references: true')
    expect(updated).toContain('title: Updated project')
    expect(updated).toContain('- neuroscience')
  })

  it('applies page metadata over project metadata without moving either source', () => {
    const page = `---
title: Page title
---
`
    const project = `version: 1
project:
  title: Project title
  description: Project description
  authors:
    - name: Grace Hopper
`
    const metadata = readMystMetadata(page, project)
    expect(metadata.page.title).toBe('Page title')
    expect(metadata.project.title).toBe('Project title')
    expect(metadata.effective.title).toBe('Page title')
    expect(metadata.effective.description).toBe('Project description')
    expect(metadata.effective.authors[0].name).toBe('Grace Hopper')
  })

  it('reports canonical ORCID and corresponding-author errors', () => {
    const metadata = readMystMetadata('', '').page
    metadata.authors.push({
      rowId: 'author-test',
      id: '',
      name: 'Ada Lovelace',
      orcid: 'not-an-orcid',
      email: '',
      corresponding: true,
      equal_contributor: false,
      roles: ['Software'],
      affiliations: [],
      original: {},
      baseline: {
        id: '',
        name: '',
        orcid: '',
        email: '',
        corresponding: false,
        equal_contributor: false,
        roles: [],
        affiliations: [],
      },
    })
    const result = validateMystMetadata(metadata, 'page')
    expect(result.errors.join(' ')).toContain('ORCID is not valid')
    expect(result.errors.join(' ')).toContain('corresponding author requires an email')
  })
})