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
4. Add a room comment before the first snapshot and verify it remains queued.
5. Save a changed snapshot and verify the pull request and queued comment are created.
6. Add another room comment and follow its **PR comment** link.
7. Resolve and reopen a room comment; verify the same GitHub comment is updated rather than duplicated.
8. Verify that both head and base belong to the standalone repository.
9. Close the PR and delete the test branch or repository when finished.

## Required Checks

Before treating a test as successful, verify:

- The commit author is the GitHub user who selected **Save to GitHub**.
- The branch exists only in the intended repository.
- The compare view contains only the intended file and lines.
- The PR base repository, base branch, and head branch are exactly correct.
- Each room comment appears once in the PR conversation and contains its hidden DeMystify marker.
- No upstream repository received an open PR.

## Collaboration Persistence Test

The integration test starts an isolated application server, rejects anonymous and unauthorized sockets, connects two authorized clients, and verifies text/comment convergence. When `DATABASE_URL` is set, it also asserts persisted sessions, rooms, and Yjs updates:

```bash
createdb demystify_test
DATABASE_URL=postgresql://localhost/demystify_test npm run test:collaboration
```

GitHub Actions runs this path against PostgreSQL 16. Use only a disposable database because the test creates DeMystify tables and records.