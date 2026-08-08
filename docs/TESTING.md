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
4. Select a changed paragraph, add a thread and reply, then edit before it; verify the highlight remains attached.
5. Add another thread on an unchanged paragraph and verify both threads remain queued before the first snapshot.
6. Save a changed snapshot. Verify the changed paragraph becomes a native GitHub review thread and the unchanged paragraph becomes a linked conversation fallback.
7. Reply and resolve from both DeMystify and GitHub. Refocus DeMystify and verify replies and native resolution synchronize without duplication.
8. Delete anchored source and verify DeMystify preserves the orphaned thread's original quote.
9. Verify that both head and base belong to the standalone repository.
10. Close the PR and delete the test branch or repository when finished.

Before deleting the branch, refresh its room and verify it becomes read-only. Confirm snapshot and comment mutation requests return `409`, stale WebSocket edits do not reach another client, and **Start next revision** opens a new room bound to the same manuscript without creating a branch until its first snapshot.

## Viewer Link Test

1. Create a viewer link from **Share** and open it in a private browser with no GitHub session.
2. Verify the fragment secret disappears after activation and the manuscript, preview, comments, and live editor updates load.
3. Attempt source, comment, snapshot, binding, and revision mutations; each must remain disabled in the UI and return `403` if called directly.
4. Keep an editor and viewer open simultaneously. Verify editor changes reach the viewer while viewer Yjs updates do not reach the editor.
5. Rotate the link. Confirm the old URL and existing viewer session stop working.
6. Revoke the new link. Confirm active viewer sockets disconnect immediately and cannot reconnect.

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