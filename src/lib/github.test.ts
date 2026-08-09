import { describe, expect, it } from 'vitest'
import {
  getRepositoryFileGitHubUrl,
  getRepositoryGitHubUrl,
  type RepositoryBinding,
} from './github'

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
})