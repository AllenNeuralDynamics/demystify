import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRepositoryFileGitHubUrl,
  getRepositoryGitHubUrl,
  loadRepositoryBibliography,
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
})