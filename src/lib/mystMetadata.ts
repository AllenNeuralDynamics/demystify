import { ROLES, credit } from 'credit-roles'
import {
  validatePageFrontmatter,
  validateProjectFrontmatter,
} from 'myst-frontmatter'
import { orcid } from 'orcid'
import { Document, parseDocument } from 'yaml'

type MetadataScope = 'page' | 'project'

interface AuthorFields {
  id: string
  name: string
  orcid: string
  email: string
  corresponding: boolean
  equal_contributor: boolean
  roles: string[]
  affiliations: string[]
}

interface AffiliationFields {
  id: string
  name: string
  institution: string
  department: string
  ror: string
  country: string
}

export interface MystAuthorForm extends AuthorFields {
  rowId: string
  original: unknown
  baseline: AuthorFields
}

export interface MystAffiliationForm extends AffiliationFields {
  rowId: string
  original: unknown
  baseline: AffiliationFields
}

interface MetadataFields {
  title: string
  subtitle: string
  description: string
  date: string
  license: string
  keywords: string[]
  authors: MystAuthorForm[]
  affiliations: MystAffiliationForm[]
}

interface MetadataBaseline {
  title: string
  subtitle: string
  description: string
  date: string
  license: string
  keywords: string[]
  authors: AuthorFields[]
  affiliations: AffiliationFields[]
}

export interface MystMetadataForm extends MetadataFields {
  baseline: MetadataBaseline
}

export interface MystMetadataSources {
  page: MystMetadataForm
  project: MystMetadataForm
  effective: MystMetadataForm
  pageFrontmatterExists: boolean
  projectConfigExists: boolean
}

export interface MystMetadataValidation {
  errors: string[]
  warnings: string[]
}

const metadataKeys = [
  'title',
  'subtitle',
  'description',
  'date',
  'license',
  'keywords',
  'authors',
  'affiliations',
] as const

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const textValue = (value: unknown) => typeof value === 'string' ? value : ''

const stringList = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : typeof value === 'string'
    ? value.split(';').map((item) => item.trim()).filter(Boolean)
    : []

const displayName = (value: unknown) => {
  if (typeof value === 'string') return value
  const name = asRecord(value)
  if (!name) return ''
  if (typeof name.literal === 'string') return name.literal
  return [name.given, name.family].filter((item): item is string => typeof item === 'string')
    .join(' ')
}

const authorFields = (value: unknown): AuthorFields => {
  const author = asRecord(value)
  if (!author) {
    return {
      id: '',
      name: typeof value === 'string' ? value : '',
      orcid: '',
      email: '',
      corresponding: false,
      equal_contributor: false,
      roles: [],
      affiliations: [],
    }
  }
  return {
    id: textValue(author.id),
    name: displayName(author.name),
    orcid: textValue(author.orcid),
    email: textValue(author.email),
    corresponding: author.corresponding === true,
    equal_contributor: author.equal_contributor === true,
    roles: stringList(author.roles),
    affiliations: stringList(author.affiliations),
  }
}

const affiliationFields = (value: unknown): AffiliationFields => {
  const affiliation = asRecord(value) ?? {}
  return {
    id: textValue(affiliation.id),
    name: textValue(affiliation.name),
    institution: textValue(affiliation.institution),
    department: textValue(affiliation.department),
    ror: textValue(affiliation.ror),
    country: textValue(affiliation.country),
  }
}

const sameValue = (first: unknown, second: unknown) =>
  JSON.stringify(first) === JSON.stringify(second)

const setOptional = (
  target: Record<string, unknown>,
  key: string,
  value: string | string[] | boolean,
) => {
  const empty = typeof value === 'string'
    ? !value.trim()
    : Array.isArray(value)
      ? !value.length
      : value === false
  if (empty) delete target[key]
  else target[key] = value
}

const authorToYaml = (author: MystAuthorForm) => {
  const fields = authorFields(author)
  if (sameValue(fields, author.baseline)) return author.original
  const output = asRecord(author.original)
    ? { ...asRecord(author.original) }
    : { name: author.baseline.name }
  if (fields.name !== author.baseline.name) setOptional(output, 'name', fields.name)
  if (fields.id !== author.baseline.id) setOptional(output, 'id', fields.id)
  if (fields.orcid !== author.baseline.orcid) setOptional(output, 'orcid', fields.orcid)
  if (fields.email !== author.baseline.email) setOptional(output, 'email', fields.email)
  if (fields.corresponding !== author.baseline.corresponding) {
    setOptional(output, 'corresponding', fields.corresponding)
  }
  if (fields.equal_contributor !== author.baseline.equal_contributor) {
    setOptional(output, 'equal_contributor', fields.equal_contributor)
  }
  if (!sameValue(fields.roles, author.baseline.roles)) setOptional(output, 'roles', fields.roles)
  if (!sameValue(fields.affiliations, author.baseline.affiliations)) {
    setOptional(output, 'affiliations', fields.affiliations)
  }
  return output
}

const affiliationToYaml = (affiliation: MystAffiliationForm) => {
  const fields = affiliationFields(affiliation)
  if (sameValue(fields, affiliation.baseline)) return affiliation.original
  const output = asRecord(affiliation.original)
    ? { ...asRecord(affiliation.original) }
    : {}
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== affiliation.baseline[key as keyof AffiliationFields]) {
      setOptional(output, key, value)
    }
  })
  return output
}

const metadataRecord = (value: unknown) => asRecord(value) ?? {}

const formFromRecord = (value: unknown): MystMetadataForm => {
  const record = metadataRecord(value)
  const authors = (Array.isArray(record.authors) ? record.authors : []).map((author, index) => {
    const baseline = authorFields(author)
    return {
      ...baseline,
      rowId: `author-${index}-${baseline.id || baseline.name}`,
      original: author,
      baseline,
    }
  })
  const affiliations = (Array.isArray(record.affiliations) ? record.affiliations : [])
    .map((affiliation, index) => {
      const baseline = affiliationFields(affiliation)
      return {
        ...baseline,
        rowId: `affiliation-${index}-${baseline.id || baseline.name || baseline.institution}`,
        original: affiliation,
        baseline,
      }
    })
  const fields: MetadataFields = {
    title: textValue(record.title),
    subtitle: textValue(record.subtitle),
    description: textValue(record.description),
    date: textValue(record.date),
    license: textValue(record.license),
    keywords: stringList(record.keywords),
    authors,
    affiliations,
  }
  return {
    ...fields,
    baseline: {
      ...fields,
      authors: authors.map(authorFields),
      affiliations: affiliations.map(affiliationFields),
    },
  }
}

const parseYamlDocument = (source: string, label: string) => {
  const document = parseDocument(source, {
    keepSourceTokens: true,
    prettyErrors: true,
  })
  if (document.errors.length) {
    throw new Error(`${label}: ${document.errors.map((error) => error.message).join('; ')}`)
  }
  return document
}

interface PageFrontmatterBlock {
  opening: string
  yaml: string
  closing: string
  rest: string
  exists: boolean
}

const pageFrontmatterBlock = (source: string): PageFrontmatterBlock => {
  const match = source.match(/^(\uFEFF?---[\t ]*\r?\n)([\s\S]*?)(^---[\t ]*\r?$)(\r?\n)?/m)
  if (!match) return { opening: '', yaml: '', closing: '', rest: source, exists: false }
  return {
    opening: match[1],
    yaml: match[2],
    closing: `${match[3]}${match[4] ?? ''}`,
    rest: source.slice(match[0].length),
    exists: true,
  }
}

const pageRecord = (source: string) => {
  const block = pageFrontmatterBlock(source)
  if (!block.exists) return { record: {}, exists: false }
  const document = parseYamlDocument(block.yaml, 'Page frontmatter')
  return { record: metadataRecord(document.toJS()), exists: true }
}

const projectRecord = (source: string) => {
  if (!source.trim()) return { record: {}, exists: false }
  const document = parseYamlDocument(source, 'myst.yml')
  return {
    record: metadataRecord(metadataRecord(document.toJS()).project),
    exists: true,
  }
}

export const readMystMetadata = (
  pageSource: string,
  projectSource: string,
): MystMetadataSources => {
  const page = pageRecord(pageSource)
  const project = projectRecord(projectSource)
  return {
    page: formFromRecord(page.record),
    project: formFromRecord(project.record),
    effective: formFromRecord({ ...project.record, ...page.record }),
    pageFrontmatterExists: page.exists,
    projectConfigExists: project.exists,
  }
}

const formFields = (form: MystMetadataForm) => ({
  title: form.title,
  subtitle: form.subtitle,
  description: form.description,
  date: form.date,
  license: form.license,
  keywords: form.keywords,
  authors: form.authors.map(authorFields),
  affiliations: form.affiliations.map(affiliationFields),
})

const updateDocumentMetadata = (
  document: Document,
  path: string[],
  form: MystMetadataForm,
) => {
  const fields = formFields(form)
  const setField = (key: typeof metadataKeys[number], value: unknown) => {
    const fieldPath = [...path, key]
    const empty = typeof value === 'string'
      ? !value.trim()
      : Array.isArray(value)
        ? !value.length
        : value == null
    if (empty) document.deleteIn(fieldPath)
    else document.setIn(fieldPath, value)
  }
  metadataKeys.slice(0, 6).forEach((key) => {
    if (!sameValue(fields[key], form.baseline[key])) setField(key, fields[key])
  })
  if (!sameValue(fields.authors, form.baseline.authors)) {
    setField('authors', form.authors.map(authorToYaml))
  }
  if (!sameValue(fields.affiliations, form.baseline.affiliations)) {
    setField('affiliations', form.affiliations.map(affiliationToYaml))
  }
}

const documentString = (document: Document, lineEnding: string) =>
  document.toString({ lineWidth: 0 }).replace(/\n/g, lineEnding)

export const updatePageMystMetadata = (
  source: string,
  form: MystMetadataForm,
) => {
  const block = pageFrontmatterBlock(source)
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const document = parseYamlDocument(block.yaml, 'Page frontmatter')
  updateDocumentMetadata(document, [], form)
  const yaml = documentString(document, lineEnding)
  if (!block.exists) return `---${lineEnding}${yaml}---${lineEnding}${lineEnding}${source}`
  return `${block.opening}${yaml}${block.closing}${block.rest}`
}

export const updateProjectMystMetadata = (
  source: string,
  form: MystMetadataForm,
) => {
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const document = parseYamlDocument(source, 'myst.yml')
  if (!document.hasIn(['version'])) document.setIn(['version'], 1)
  if (!document.hasIn(['project'])) document.setIn(['project'], {})
  updateDocumentMetadata(document, ['project'], form)
  return documentString(document, lineEnding)
}

export const validateMystMetadata = (
  form: MystMetadataForm,
  scope: MetadataScope,
): MystMetadataValidation => {
  const messages: {
    errors: Array<{ property: string; message: string }>
    warnings: Array<{ property: string; message: string }>
  } = { errors: [], warnings: [] }
  const record = {
    ...formFields(form),
    authors: form.authors.map(authorToYaml),
    affiliations: form.affiliations.map(affiliationToYaml),
  }
  const options = {
    property: scope === 'page' ? 'frontmatter' : 'project',
    messages,
    suppressErrors: true,
    suppressWarnings: true,
  }
  try {
    if (scope === 'page') validatePageFrontmatter(record, options)
    else validateProjectFrontmatter(record, options)
  } catch (error) {
    messages.errors.push({
      property: options.property,
      message: error instanceof Error ? error.message : 'MyST metadata validation failed.',
    })
  }
  form.authors.forEach((author, index) => {
    if (author.orcid && !orcid.validate(author.orcid)) {
      messages.errors.push({ property: `authors.${index}.orcid`, message: 'ORCID is not valid.' })
    }
    if (author.corresponding && !author.email.trim()) {
      messages.errors.push({
        property: `authors.${index}.email`,
        message: 'A corresponding author requires an email address.',
      })
    }
    author.roles.forEach((role, roleIndex) => {
      if (!credit.validate(role)) {
        messages.warnings.push({
          property: `authors.${index}.roles.${roleIndex}`,
          message: `"${role}" is not a standard CRediT role.`,
        })
      }
    })
  })
  return {
    errors: messages.errors.map((message) => `${message.property}: ${message.message}`),
    warnings: messages.warnings.map((message) => `${message.property}: ${message.message}`),
  }
}

export const creditRoles = [...ROLES]

export const createMystAuthor = (index: number): MystAuthorForm => {
  const baseline = authorFields({})
  return {
    ...baseline,
    rowId: `new-author-${index}`,
    original: {},
    baseline,
  }
}

export const createMystAffiliation = (index: number): MystAffiliationForm => {
  const baseline = affiliationFields({})
  return {
    ...baseline,
    rowId: `new-affiliation-${index}`,
    original: {},
    baseline,
  }
}