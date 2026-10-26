import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindCollaborationRoom,
  createSnapshot,
  getNewManuscriptRoomUrl,
  getRepositoryFileGitHubUrl,
  getRepositoryGitHubUrl,
  loadRepositoryBibliography,
  loadRepositoryMystConfig,
  loadRepositoryProjectFiles,
  listRepositoryContents,
  type RepositoryBinding,
} from './github'

afterEach(() => vi.unstubAllGlobals())

const binding: RepositoryBinding = {
  owner: 'AllenNeuralDynamics',
  repository: 'openscope_p3_data_release_paper',
  fullName: 'AllenNeuralDynamics/openscope_p3_data_release_paper',
  isFork: false,
  parentFullName: null,
  path: 'paper/index.md',
  baseBranch: 'main',
  branchName: 'demystify/room-123',
}

describe('GitHub repository links', () => {
  it('carries a selected branch into new rooms and binding requests', async () => {
    const selected = { ...binding, baseBranch: 'revision/two' }
    expect(new URL(getNewManuscriptRoomUrl('https://editor.example/', 'new-room', selected)).searchParams.get('branch')).toBe('revision/two')
    const fetch = vi.fn().mockImplementation(async () => new Response('{"entries":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    await bindCollaborationRoom('new-room', selected)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).baseBranch).toBe('revision/two')
    await listRepositoryContents({ owner: 'research', name: 'paper', defaultBranch: 'main' } as Parameters<typeof listRepositoryContents>[0], '', 'revision/two')
    expect(String(fetch.mock.calls[1][0])).toContain('ref=revision%2Ftwo')
  })

  it('opens another manuscript in a new room without transferring sharing or recovery state', () => {
    const url = new URL(getNewManuscriptRoomUrl(
      'https://editor.example/?doc=original&serverCopy=1&recoverySession=private#collaborate=private-token',
      'new-room',
    ))
    expect(url.searchParams.get('doc')).toBe('new-room')
    expect(url.searchParams.get('import')).toBe('github')
    expect(Array.from(url.searchParams.keys())).toEqual(['doc', 'import'])
    expect(url.hash).toBe('')
  })

  it('prefills a new manuscript version without rebinding the existing room', () => {
    const url = new URL(getNewManuscriptRoomUrl('https://editor.example/?doc=old-room', 'new-room', binding))
    expect(url.searchParams.get('repository')).toBe(binding.fullName)
    expect(url.searchParams.get('path')).toBe(binding.path)
    expect(url.searchParams.get('doc')).toBe('new-room')
  })

  it('links to the bound repository', () => {
    expect(getRepositoryGitHubUrl(binding)).toBe(
      'https://github.com/AllenNeuralDynamics/openscope_p3_data_release_paper',
    )
  })

  it('links to the exact file and slash-containing working branch', () => {
    expect(getRepositoryFileGitHubUrl(binding, binding.branchName)).toBe(
      'https://github.com/AllenNeuralDynamics/openscope_p3_data_release_paper/blob/demystify/room-123/paper/index.md',
    )
  })

  it('loads references.bib beside the bound manuscript', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: '@article{paper, title={Paper}}',
      sha: 'bib-sha',
      path: 'paper/references.bib',
      htmlUrl: 'https://github.com/example',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadRepositoryBibliography(binding)).resolves.toMatchObject({
      exists: true,
      path: 'paper/references.bib',
      sha: 'bib-sha',
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('path=paper%2Freferences.bib')
  })

  it('uses an empty library when references.bib does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Not Found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )))
    await expect(loadRepositoryBibliography(binding)).resolves.toEqual({
      content: '',
      sha: null,
      path: 'paper/references.bib',
      htmlUrl: null,
      exists: false,
    })
  })

  it('loads the nearest MyST project configuration through one server request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: 'version: 1\n',
      sha: 'config-sha',
      path: 'myst.yml',
      htmlUrl: 'https://github.com/example/myst.yml',
      exists: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadRepositoryMystConfig(binding)).resolves.toMatchObject({
      exists: true,
      path: 'myst.yml',
      sha: 'config-sha',
    })
    const requestUrl = String(fetchMock.mock.calls[0][0])
    expect(requestUrl).toContain('/api/github/myst-config?')
    expect(requestUrl).toContain('path=paper%2Findex.md')
  })

  it('loads the canonical MyST project file manifest through one server request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      config: { content: 'version: 1\n', path: 'myst.yml', exists: true },
      files: [{
        content: '# Paper\n',
        sha: 'paper-sha',
        path: 'paper/index.md',
        htmlUrl: 'https://github.com/example/paper/index.md',
      }],
      missing: [],
      bibliographyPaths: ['paper/references.bib'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadRepositoryProjectFiles(binding)).resolves.toMatchObject({
      files: [{ path: 'paper/index.md' }],
      missing: [],
      bibliographyPaths: ['paper/references.bib'],
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/github/project-files?')
  })

  it('sends manuscript, bibliography, config, and secondary files in one snapshot request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      branchName: 'demystify/room-123',
      commitSha: 'commit-sha',
      commitUrl: 'https://github.com/example/commit-sha',
      fileSha: 'file-sha',
      unchanged: false,
      review: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await createSnapshot(
      'room-12345',
      '# Main\n',
      { path: 'paper/refs/library.bib', content: '@article{paper, title={Paper}}\n' },
      { path: 'paper/myst.yml', content: 'version: 1\n' },
      [{ path: 'paper/methods.md', content: '# Methods\n' }],
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      content: '# Main\n',
      bibliography: {
        path: 'paper/refs/library.bib',
        content: '@article{paper, title={Paper}}\n',
      },
      mystConfig: { path: 'paper/myst.yml', content: 'version: 1\n' },
      projectFiles: [{ path: 'paper/methods.md', content: '# Methods\n' }],
    })
  })
})