# Safe GitHub Integration Testing

## Snapshot Test Against a Fork

A personal fork is useful for testing repository discovery, file loading, collaborative editing, and branch snapshots without changing the upstream repository.

1. Install the test GitHub App only on the personal fork.
2. Open the fork's manuscript file in DeMystify.
3. Make a harmless edit and select **Save to GitHub**.
4. Verify the resulting `demystify/...` branch and commit in the fork.

Do not use GitHub's **Compare & pull request** prompt on that branch: fork-network prompts commonly default the base repository to the upstream parent. DeMystify disables automatic PR creation for fork bindings.

## Fully Isolated Pull-Request Test

Use a standalone personal repository that is not a GitHub fork:

1. Create a new test repository with an `index.md` file.
2. Add that repository to the test GitHub App installation.
3. Open `index.md` in DeMystify and make a harmless edit.
4. Save the snapshot and create the pull request.
5. Verify that both head and base belong to the standalone repository.
6. Close the PR and delete the test branch or repository when finished.

## Required Checks

Before treating a test as successful, verify:

- The commit author is the GitHub user who selected **Save to GitHub**.
- The branch exists only in the intended repository.
- The compare view contains only the intended file and lines.
- The PR base repository, base branch, and head branch are exactly correct.
- No upstream repository received an open PR.