# Testing

## Automated Local Browser Suite

The Playwright suite exercises the real React application, Express API, and Yjs
WebSocket gateway entirely on localhost. It starts Vite on port 4173 and a
temporary test-auth server on port 8791. The configuration contains no remote
base URL, so routine browser tests cannot consume Replit deployment credits.

Install the browser binaries once:

```bash
npx playwright install chromium firefox webkit
```

Run the fast Chromium suite while developing, then the complete matrix before a
release:

```bash
npm run test:e2e:quick
npm run test:e2e
```

The complete matrix covers desktop Chromium, Firefox, and WebKit plus emulated
Mobile Chrome and Mobile Safari. Core startup, maintainer authoring, dialogs,
focus, and Escape ordering run in all five projects. Viewer and Suggestion-mode
collaboration run in the three desktop engines. Axe analysis, responsive geometry,
visual regression, and disconnect/reconnect recovery run once in Chromium because
they validate engine-independent DOM policy or deterministic Chromium baselines.
Across those projects, the suite includes:

- Anonymous and authenticated application startup
- Maintainer authoring, comments, view modes, dialogs, focus, and Escape ordering
- Live viewer and suggestion-mode synchronization with independent browser sessions
- Ten-minute idle WebSocket suspension and activity-based reconnection
- Exact responsive breakpoints, short-landscape actions, and overflow checks
- Automated WCAG A/AA analysis with axe
- Desktop, mobile, and short-landscape visual regression baselines
- Automatic failure on page exceptions, HTTP 5xx responses, and unexpected console errors

Playwright traces, screenshots, videos, and the HTML report are generated under
gitignored `test-results/` and `playwright-report/` directories. GitHub Actions
retains the HTML report for 14 days. No GitHub or Replit credentials are needed;
the E2E server enables the guarded test session route only under `NODE_ENV=test`.

Visual baselines are review artifacts, not an automatic approval mechanism. The
text-heavy workspace baselines are platform-specific because Linux and macOS font
metrics wrap the same bundled fonts differently. After an intentional interface
change, regenerate the current platform's baselines and inspect every image before
committing:

```bash
npm run test:e2e:update -- e2e/visual.spec.ts
npm run test:e2e:quick -- e2e/visual.spec.ts
```

The production build also has gzip budgets. Build before checking them:

```bash
npm run build
npm run test:bundle
```

Manual release checks still include VoiceOver, browser zoom, reduced motion, and
at least one physical touch device. Those checks should use localhost whenever
possible. Limit the deployed application to a brief health and sign-in smoke test
after promotion.

## Safe GitHub Integration Testing

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

For a local live-GitHub test without copying an OAuth secret into `.env`, run a
separate test server bound to localhost with `NODE_ENV=test`,
`ENABLE_TEST_AUTH=1`, `ENABLE_LIVE_GITHUB_TEST=1`, and
`TEST_GITHUB_TOKEN="$(gh auth token)"`. The token remains in the server process
environment and is never returned to the browser. Use only a disposable
standalone personal repository, unique persistence paths, and dedicated ports;
never enable this route in a shared or deployed environment.

Before deleting the branch, refresh its room and verify it becomes read-only. Confirm snapshot and comment mutation requests return `409`, stale WebSocket edits do not reach another client, and **Start next revision** opens a new room bound to the same manuscript without creating a branch until its first snapshot.

## Viewer Link Test

1. Create a viewer link from **Share** and open it in a private browser with no GitHub session.
2. Verify the fragment secret disappears after activation and the manuscript, preview, comments, and live editor updates load.
3. Attempt source, comment, snapshot, binding, and revision mutations; each must remain disabled in the UI and return `403` if called directly.
4. Keep an editor and viewer open simultaneously. Verify editor changes reach the viewer while viewer Yjs updates do not reach the editor.
5. Rotate the link. Confirm the old URL and existing viewer session stop working.
6. Revoke the new link. Confirm active viewer sockets disconnect immediately and cannot reconnect.

## Maintainer Link Test

1. Copy the Maintainer link from **Share** and verify it is the plain room URL with no capability fragment.
2. Open it without a GitHub session and verify DeMystify prompts for GitHub authentication rather than opening the room.
3. Authenticate as a user without repository write permission and verify the plain link still grants no room access.
4. Authenticate as a repository writer and verify the room opens in Maintainer mode with publishing and sharing controls.

## Suggestion Link Test

1. Open a Suggestion link in a private browser. Verify the token disappears from the address bar; source, metadata, and references are read-only; comments and supported primary-file Visual prose edits remain available.
2. Connect a GitHub account that lacks repository write permission. Verify the room remains in Suggestion mode and the account name plus handle label new presence, comments, suggestions, and replies.
3. Propose a Visual edit. Verify the maintainer receives attributed before/after text in both Source and Visual while canonical `Y.Text` remains unchanged. Activate either surface to open Review, reply from both sessions, then accept and verify the source converges and both pending overlays disappear. Repeat with Reject and with a concurrent maintainer edit that must produce a conflict.
4. Verify the contributor cannot change the repository binding, manage sharing, save a snapshot, start a revision, or invoke a GitHub comment route.
5. With no maintainer connected, verify review records remain queued. Reconnect a maintainer and verify comments, suggestion state, decisions, and replies mirror once to the pull request with contributor attribution.
6. Rotate or revoke the Suggestion link. Confirm Suggestion sockets disconnect while active viewer and maintainer sockets remain connected.

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