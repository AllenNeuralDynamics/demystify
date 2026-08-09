import {
  Building2,
  FileText,
  Plus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  readAuthorshipMetadataSources,
  type AuthorshipMetadataSource,
} from '../lib/authorshipMetadata'
import type { BibliographyEditResult } from '../lib/references'
import {
  createMystAffiliation,
  createMystAuthor,
  creditRoles,
  readMystMetadata,
  updatePageMystMetadata,
  updateProjectMystMetadata,
  validateMystMetadata,
  type MystAffiliationForm,
  type MystAuthorForm,
  type MystMetadataForm,
} from '../lib/mystMetadata'

type MetadataScope = 'page' | 'project'
const emptyProjectFiles: Record<string, string> = {}

interface PublicationMetadataProps {
  authorshipSources?: AuthorshipMetadataSource[]
  pageSource: string
  pagePath?: string
  projectFiles?: Record<string, string>
  projectSource: string
  projectPath: string
  readOnly: boolean
  onApply: (input: {
    expectedPage: string
    expectedProject: string
    replacementPage: string
    replacementProject: string
  }) => BibliographyEditResult
  onClose: () => void
}

const cloneForm = (form: MystMetadataForm): MystMetadataForm => structuredClone(form)

const initialMetadata = (pageSource: string, projectSource: string) => {
  try {
    return { sources: readMystMetadata(pageSource, projectSource), error: null }
  } catch (error) {
    return {
      sources: readMystMetadata('', ''),
      error: error instanceof Error ? error.message : 'MyST metadata could not be parsed.',
    }
  }
}

const listInput = (value: string) => value
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const inheritedText = (value: string | string[]) => {
  const text = Array.isArray(value) ? value.join(', ') : value
  return text ? `Inherited: ${text}` : undefined
}

export const PublicationMetadata = ({
  authorshipSources,
  pageSource,
  pagePath = 'manuscript.md',
  projectFiles = emptyProjectFiles,
  projectSource,
  projectPath,
  readOnly,
  onApply,
  onClose,
}: PublicationMetadataProps) => {
  const [initial] = useState(() => initialMetadata(pageSource, projectSource))
  const [scope, setScope] = useState<MetadataScope>('page')
  const [pageDraft, setPageDraft] = useState(() => cloneForm(initial.sources.page))
  const [projectDraft, setProjectDraft] = useState(() => cloneForm(initial.sources.project))
  const [pageDirty, setPageDirty] = useState(false)
  const [projectDirty, setProjectDirty] = useState(false)
  const [errors, setErrors] = useState<string[]>(initial.error ? [initial.error] : [])
  const [warnings, setWarnings] = useState<string[]>([])
  const detectedAuthorshipSources = useMemo(
    () => readAuthorshipMetadataSources(pageSource, pagePath, projectFiles),
    [pagePath, pageSource, projectFiles],
  )
  const visibleAuthorshipSources = authorshipSources ?? detectedAuthorshipSources
  const current = scope === 'page' ? pageDraft : projectDraft
  const inherited = initial.sources.project

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const updateCurrent = (update: (form: MystMetadataForm) => MystMetadataForm) => {
    if (scope === 'page') {
      setPageDraft(update)
      setPageDirty(true)
    } else {
      setProjectDraft(update)
      setProjectDirty(true)
    }
    setErrors([])
  }

  const updateField = (
    field: 'title' | 'subtitle' | 'description' | 'date' | 'license' | 'keywords',
    value: string | string[],
  ) => updateCurrent((form) => ({ ...form, [field]: value }))

  const updateAuthor = (
    rowId: string,
    update: (author: MystAuthorForm) => MystAuthorForm,
  ) => updateCurrent((form) => ({
    ...form,
    authors: form.authors.map((author) => author.rowId === rowId ? update(author) : author),
  }))

  const updateAffiliation = (
    rowId: string,
    update: (affiliation: MystAffiliationForm) => MystAffiliationForm,
  ) => updateCurrent((form) => ({
    ...form,
    affiliations: form.affiliations.map((affiliation) =>
      affiliation.rowId === rowId ? update(affiliation) : affiliation),
  }))

  const save = () => {
    const pageValidation = pageDirty
      ? validateMystMetadata(pageDraft, 'page')
      : { errors: [], warnings: [] }
    const projectValidation = projectDirty
      ? validateMystMetadata(projectDraft, 'project')
      : { errors: [], warnings: [] }
    const nextErrors = [...pageValidation.errors, ...projectValidation.errors]
    setErrors(nextErrors)
    setWarnings([...pageValidation.warnings, ...projectValidation.warnings])
    if (nextErrors.length) return
    let replacementPage = pageSource
    let replacementProject = projectSource
    try {
      if (pageDirty) replacementPage = updatePageMystMetadata(pageSource, pageDraft)
      if (projectDirty) replacementProject = updateProjectMystMetadata(projectSource, projectDraft)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'MyST metadata could not be saved.'])
      return
    }
    const result = onApply({
      expectedPage: pageSource,
      expectedProject: projectSource,
      replacementPage,
      replacementProject,
    })
    if (result === 'conflict') {
      setErrors(['The manuscript or myst.yml changed elsewhere. Close this panel and try again.'])
      return
    }
    if (result === 'unavailable') {
      setErrors(['Publication metadata is not writable in this room.'])
      return
    }
    onClose()
  }

  const scopeHint = scope === 'page'
    ? 'Page frontmatter overrides inherited project values.'
    : `Project-wide values are stored under project in ${projectPath}.`

  return (
    <div className="publication-metadata-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="publication-metadata" role="dialog" aria-modal="true" aria-labelledby="publication-metadata-title">
        <header className="publication-metadata-header">
          <div>
            <h2 id="publication-metadata-title">Publication metadata</h2>
            <span>Canonical MyST frontmatter and project configuration</span>
          </div>
          <button className="icon-button" type="button" title="Close publication metadata" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="metadata-scope" aria-label="Metadata scope">
          <button className={scope === 'page' ? 'active' : ''} type="button" onClick={() => setScope('page')}>
            <FileText size={15} /> This page
          </button>
          <button className={scope === 'project' ? 'active' : ''} type="button" onClick={() => setScope('project')}>
            <Building2 size={15} /> Whole project
          </button>
          <span>{scopeHint}</span>
        </div>

        <div className="metadata-form-scroll">
          <section className="metadata-section">
            <div className="metadata-section-heading">
              <h3>Document</h3>
              <span>{scope === 'page' ? 'Page-level overrides' : 'Project defaults'}</span>
            </div>
            <div className="metadata-field-grid">
              <label className="metadata-field wide">
                <span>Title</span>
                <input
                  aria-label={`${scope} title`}
                  value={current.title}
                  placeholder={scope === 'page' ? inheritedText(inherited.title) : undefined}
                  onChange={(event) => updateField('title', event.target.value)}
                />
              </label>
              <label className="metadata-field wide">
                <span>Subtitle</span>
                <input
                  aria-label={`${scope} subtitle`}
                  value={current.subtitle}
                  placeholder={scope === 'page' ? inheritedText(inherited.subtitle) : undefined}
                  onChange={(event) => updateField('subtitle', event.target.value)}
                />
              </label>
              <label className="metadata-field wide">
                <span>Description</span>
                <textarea
                  aria-label={`${scope} description`}
                  value={current.description}
                  placeholder={scope === 'page' ? inheritedText(inherited.description) : undefined}
                  onChange={(event) => updateField('description', event.target.value)}
                />
              </label>
              <label className="metadata-field">
                <span>Date</span>
                <input
                  aria-label={`${scope} date`}
                  value={current.date}
                  placeholder={scope === 'page' ? inheritedText(inherited.date) : 'YYYY-MM-DD'}
                  onChange={(event) => updateField('date', event.target.value)}
                />
              </label>
              <label className="metadata-field">
                <span>Content license</span>
                <input
                  aria-label={`${scope} license`}
                  value={current.license}
                  placeholder={scope === 'page' ? inheritedText(inherited.license) : 'CC-BY-4.0'}
                  onChange={(event) => updateField('license', event.target.value)}
                />
              </label>
              <label className="metadata-field wide">
                <span>Keywords</span>
                <input
                  aria-label={`${scope} keywords`}
                  value={current.keywords.join(', ')}
                  placeholder={scope === 'page' ? inheritedText(inherited.keywords) : 'Comma-separated keywords'}
                  onChange={(event) => updateField('keywords', listInput(event.target.value))}
                />
              </label>
            </div>
          </section>

          <section className="metadata-section">
            <div className="metadata-section-heading">
              <div>
                <h3>Authors</h3>
                <span>MyST authors, ORCID, affiliations, and CRediT roles</span>
              </div>
              <button className="button secondary-button" type="button" disabled={readOnly} onClick={() => updateCurrent((form) => ({
                ...form,
                authors: [...form.authors, createMystAuthor(form.authors.length)],
              }))}>
                <Plus size={14} /> Add author
              </button>
            </div>
            <div className="metadata-card-list">
              {!current.authors.length && <div className="metadata-empty">No canonical MyST authors set in this scope.</div>}
              {current.authors.map((author, index) => (
                <article className="metadata-card" key={author.rowId}>
                  <div className="metadata-card-title">
                    <span className="metadata-card-icon"><UserRound size={15} /></span>
                    <strong>{author.name || `Author ${index + 1}`}</strong>
                    <button className="icon-button danger" type="button" title={`Remove ${author.name || `author ${index + 1}`}`} disabled={readOnly} onClick={() => updateCurrent((form) => ({
                      ...form,
                      authors: form.authors.filter((candidate) => candidate.rowId !== author.rowId),
                    }))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="metadata-field-grid compact">
                    <label className="metadata-field wide">
                      <span>Name</span>
                      <input aria-label={`Author ${index + 1} name`} value={author.name} onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({ ...currentAuthor, name: event.target.value }))} />
                    </label>
                    <label className="metadata-field">
                      <span>Local ID</span>
                      <input aria-label={`Author ${index + 1} id`} value={author.id} onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({ ...currentAuthor, id: event.target.value }))} />
                    </label>
                    <label className="metadata-field">
                      <span>ORCID</span>
                      <input aria-label={`Author ${index + 1} ORCID`} placeholder="0000-0000-0000-0000" value={author.orcid} onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({ ...currentAuthor, orcid: event.target.value }))} />
                    </label>
                    <label className="metadata-field">
                      <span>Email</span>
                      <input aria-label={`Author ${index + 1} email`} type="email" value={author.email} onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({ ...currentAuthor, email: event.target.value }))} />
                    </label>
                    <label className="metadata-field wide">
                      <span>Affiliation IDs</span>
                      <input aria-label={`Author ${index + 1} affiliations`} value={author.affiliations.join(', ')} onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({ ...currentAuthor, affiliations: listInput(event.target.value) }))} />
                    </label>
                  </div>
                  <div className="metadata-checks">
                    <label><input type="checkbox" checked={author.corresponding} onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({ ...currentAuthor, corresponding: event.target.checked }))} /> Corresponding author</label>
                    <label><input type="checkbox" checked={author.equal_contributor} onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({ ...currentAuthor, equal_contributor: event.target.checked }))} /> Equal contributor</label>
                  </div>
                  <details className="credit-role-picker">
                    <summary>CRediT roles ({author.roles.length})</summary>
                    <div>
                      {creditRoles.map((role) => (
                        <label key={role}>
                          <input
                            type="checkbox"
                            checked={author.roles.includes(role)}
                            onChange={(event) => updateAuthor(author.rowId, (currentAuthor) => ({
                              ...currentAuthor,
                              roles: event.target.checked
                                ? [...currentAuthor.roles, role]
                                : currentAuthor.roles.filter((candidate) => candidate !== role),
                            }))}
                          />
                          {role}
                        </label>
                      ))}
                    </div>
                  </details>
                </article>
              ))}
            </div>
          </section>

          {visibleAuthorshipSources.length > 0 && (
            <section className="metadata-section metadata-authorship-section">
              <div className="metadata-section-heading">
                <div>
                  <h3>Authorship YAML</h3>
                  <span>AuthorshipExtractor contributor records; read-only in this panel</span>
                </div>
              </div>
              <div className="metadata-authorship-sources">
                {visibleAuthorshipSources.map((source, sourceIndex) => (
                  <section
                    className="metadata-authorship-source"
                    key={`${source.path ?? 'invalid'}-${source.label}-${sourceIndex}`}
                  >
                    <header>
                      <div>
                        <strong>{source.label}</strong>
                        <code>{source.path ?? 'Invalid YAML path'}</code>
                      </div>
                      {!source.error && (
                        <span>
                          {source.contributors.length} contributor{source.contributors.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </header>
                    {source.error ? (
                      <div className="metadata-authorship-error" role="alert">{source.error}</div>
                    ) : (
                      <div
                        className="metadata-authorship-list"
                        role="list"
                        aria-label={`${source.label} from ${source.path}`}
                      >
                        {source.contributors.map((contributor, index) => {
                          const details = [
                            contributor.id ? `ID ${contributor.id}` : '',
                            contributor.orcid ? `ORCID ${contributor.orcid}` : '',
                            contributor.email,
                            contributor.affiliations.join(', '),
                          ].filter(Boolean)
                          return (
                            <article
                              className="metadata-authorship-row"
                              key={`${contributor.id || contributor.name}-${index}`}
                              role="listitem"
                            >
                              <span className="metadata-card-icon"><UserRound size={15} /></span>
                              <div>
                                <strong>
                                  {contributor.name}
                                  {contributor.corresponding ? ' (corresponding)' : ''}
                                </strong>
                                {details.length > 0 && <small>{details.join(' | ')}</small>}
                              </div>
                              {contributor.roles.length > 0 && (
                                <span className="metadata-authorship-roles">
                                  {contributor.roles.join(', ')}
                                </span>
                              )}
                            </article>
                          )
                        })}
                        {source.contributors.length === 0 && (
                          <div className="metadata-empty">No contributors found in this YAML source.</div>
                        )}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </section>
          )}

          <section className="metadata-section">
            <div className="metadata-section-heading">
              <div>
                <h3>Affiliations</h3>
                <span>Canonical MyST affiliation objects and ROR identifiers</span>
              </div>
              <button className="button secondary-button" type="button" disabled={readOnly} onClick={() => updateCurrent((form) => ({
                ...form,
                affiliations: [
                  ...form.affiliations,
                  createMystAffiliation(form.affiliations.length),
                ],
              }))}>
                <Plus size={14} /> Add affiliation
              </button>
            </div>
            <div className="metadata-card-list">
              {!current.affiliations.length && <div className="metadata-empty">No affiliations set in this scope.</div>}
              {current.affiliations.map((affiliation, index) => (
                <article className="metadata-card" key={affiliation.rowId}>
                  <div className="metadata-card-title">
                    <span className="metadata-card-icon"><Building2 size={15} /></span>
                    <strong>{affiliation.name || affiliation.institution || `Affiliation ${index + 1}`}</strong>
                    <button className="icon-button danger" type="button" title={`Remove ${affiliation.name || affiliation.institution || `affiliation ${index + 1}`}`} disabled={readOnly} onClick={() => updateCurrent((form) => ({
                      ...form,
                      affiliations: form.affiliations.filter((candidate) => candidate.rowId !== affiliation.rowId),
                    }))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="metadata-field-grid compact">
                    {(['id', 'name', 'institution', 'department', 'ror', 'country'] as const).map((field) => (
                      <label className="metadata-field" key={field}>
                        <span>{field === 'ror' ? 'ROR' : field.replace('_', ' ')}</span>
                        <input
                          aria-label={`Affiliation ${index + 1} ${field}`}
                          value={affiliation[field]}
                          onChange={(event) => updateAffiliation(affiliation.rowId, (currentAffiliation) => ({
                            ...currentAffiliation,
                            [field]: event.target.value,
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <footer className="publication-metadata-footer">
          <div aria-live="polite">
            {errors.map((error) => <span className="error" key={error}>{error}</span>)}
            {!errors.length && warnings.map((warning) => <span key={warning}>{warning}</span>)}
          </div>
          <button className="button secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary-button" type="button" disabled={readOnly || (!pageDirty && !projectDirty)} onClick={save}>Save metadata</button>
        </footer>
      </section>
    </div>
  )
}