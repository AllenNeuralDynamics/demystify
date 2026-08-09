import { parseDocument } from 'yaml'

export interface AuthorshipContributorMetadata {
  affiliations: string[]
  corresponding: boolean
  email: string
  id: string
  name: string
  orcid: string
  roles: string[]
}

export interface AuthorshipMetadataSource {
  contributors: AuthorshipContributorMetadata[]
  error: string | null
  label: string
  path: string | null
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const stringValues = (value: unknown) => Array.isArray(value)
  ? value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
  : []

const resolveProjectPath = (sourcePath: string, value: string) => {
  const trimmed = value.trim()
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null
  const reference = trimmed.split('#', 1)[0]
  const baseDirectory = sourcePath.split('/').slice(0, -1)
  const segments = reference.startsWith('/')
    ? reference.slice(1).split('/')
    : [...baseDirectory, ...reference.split('/')]
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!normalized.length) return null
      normalized.pop()
      continue
    }
    normalized.push(segment)
  }
  return normalized.length ? normalized.join('/') : null
}

const parseContributors = (source: string) => {
  let root: Record<string, unknown> | null
  try {
    const document = parseDocument(source)
    if (document.errors.length) return null
    root = asObject(document.toJS())
  } catch {
    return null
  }
  const project = asObject(root?.project)
  const contributorValues = Array.isArray(project?.contributors)
    ? project.contributors
    : Array.isArray(root?.contributors)
      ? root.contributors
      : []
  const affiliationValues = Array.isArray(project?.affiliations)
    ? project.affiliations
    : Array.isArray(root?.affiliations)
      ? root.affiliations
      : []
  const affiliations = new Map(affiliationValues.flatMap((value) => {
    const affiliation = asObject(value)
    const id = typeof affiliation?.id === 'string' ? affiliation.id.trim() : ''
    const name = [affiliation?.name, affiliation?.institution]
      .find((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      ?.trim() ?? ''
    return id ? [[id, name || id] as const] : []
  }))

  return contributorValues.flatMap((value): AuthorshipContributorMetadata[] => {
    const contributor = asObject(value)
    if (!contributor) return []
    const explicitName = typeof contributor.name === 'string' ? contributor.name.trim() : ''
    const nameParts = [contributor.first_name, contributor.last_name]
      .flatMap((part) => typeof part === 'string' && part.trim() ? [part.trim()] : [])
    const id = typeof contributor.id === 'string' ? contributor.id.trim() : ''
    const name = explicitName || nameParts.join(' ') || id
    if (!name) return []
    const contributorAffiliations = Array.isArray(contributor.affiliations)
      ? contributor.affiliations.flatMap((entry) => {
          if (typeof entry === 'string' && entry.trim()) {
            const key = entry.trim()
            return [affiliations.get(key) ?? key]
          }
          const affiliation = asObject(entry)
          const affiliationName = [affiliation?.name, affiliation?.institution]
            .find((item): item is string => typeof item === 'string' && Boolean(item.trim()))
            ?.trim() ?? ''
          return affiliationName ? [affiliationName] : []
        })
      : []
    return [{
      affiliations: Array.from(new Set(contributorAffiliations)),
      corresponding: contributor.corresponding === true,
      email: typeof contributor.email === 'string' ? contributor.email.trim() : '',
      id,
      name,
      orcid: typeof contributor.orcid === 'string' ? contributor.orcid.trim() : '',
      roles: Array.from(new Set(stringValues(contributor.roles))),
    }]
  })
}

export const loadAuthorshipMetadataSource = (
  pathValue: string,
  label: string,
  sourcePath: string,
  projectFiles: Record<string, string>,
): AuthorshipMetadataSource => {
  const path = resolveProjectPath(sourcePath, pathValue)
  if (!path || !/\.ya?ml$/i.test(path)) {
    return { contributors: [], error: 'The authorship data path is invalid.', label, path }
  }
  const source = projectFiles[path]
  if (source === undefined) {
    return { contributors: [], error: `${path} is not available in this collaboration.`, label, path }
  }
  const contributors = parseContributors(source)
  if (!contributors) {
    return { contributors: [], error: `${path} contains invalid YAML.`, label, path }
  }
  return { contributors, error: null, label, path }
}

interface AuthorshipSourceReference {
  label: string
  path: string
}

const unquoteDirectiveOption = (value: string) =>
  value.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')

const getSourceReferences = (source: string): AuthorshipSourceReference[] => {
  const output: AuthorshipSourceReference[] = []
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^\s*((?::){3,}|(?:`){3,})\{authorship-explorer\}\s*$/i)
    if (!opening) continue
    const delimiter = opening[1][0]
    const closingPattern = new RegExp(`^\\s*\\${delimiter}{3,}\\s*$`)
    const options = new Map<string, string>()
    for (index += 1; index < lines.length && !closingPattern.test(lines[index]); index += 1) {
      const option = lines[index].match(/^\s*:([a-z0-9-]+):\s*(.*?)\s*$/i)
      if (option) options.set(option[1].toLowerCase(), unquoteDirectiveOption(option[2]))
    }
    output.push({
      label: 'Contributors',
      path: options.get('authors') ?? './authors.yml',
    })
    const alternatePath = options.get('authors-alt')
    if (alternatePath) {
      output.push({
        label: options.get('alt-label') ?? 'Real contributors',
        path: alternatePath,
      })
    }
    const secondAlternatePath = options.get('authors-alt2')
    if (secondAlternatePath) {
      output.push({
        label: options.get('alt2-label') ?? 'Large team',
        path: secondAlternatePath,
      })
    }
  }
  return output
}

export const readAuthorshipMetadataSources = (
  source: string,
  sourcePath: string,
  projectFiles: Record<string, string>,
): AuthorshipMetadataSource[] => {
  const seenPaths = new Set<string>()
  return getSourceReferences(source).flatMap((reference) => {
    const dataset = loadAuthorshipMetadataSource(
      reference.path,
      reference.label,
      sourcePath,
      projectFiles,
    )
    if (dataset.path && seenPaths.has(dataset.path)) return []
    if (dataset.path) seenPaths.add(dataset.path)
    return [dataset]
  })
}
