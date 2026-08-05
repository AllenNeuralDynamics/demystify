# Architecture

## Current Prototype

```mermaid
flowchart LR
  B[React + CodeMirror] <-->|Yjs updates and awareness| W[Express WebSocket server]
  B --> M[MyST parser + KaTeX]
  W <--> L[(Local LevelDB)]
  B <-->|HTTP-only session| G[GitHub App gateway]
  G <-->|Contents and pull requests| R[GitHub repository]
```

The browser binds CodeMirror directly to a shared `Y.Text`. The same Yjs document stores comments, while awareness carries transient cursors and collaborator profiles. The Express server handles both API requests and WebSocket upgrades. Local LevelDB persists Yjs updates.

The browser uses the official JavaScript MyST parser for immediate feedback. This preview is intentionally lightweight and does not yet execute a repository's full `myst.yml`, plugins, bibliography, or generated-asset pipeline.

GitHub is updated only through explicit snapshots. The gateway creates a stable `demystify/<room>` branch, writes the manuscript through the Contents API, and creates or reopens a pull request.

## Production Target

```mermaid
flowchart LR
  U[GitHub-authenticated collaborators] --> A[Cloud Run: web, API, WebSockets]
  A <--> P[(Postgres: Yjs state, rooms, sessions, audit)]
  A <-->|Pub/Sub when scaled| X[(Redis)]
  A --> Q[Sandboxed MyST preview worker]
  Q --> O[(Preview artifacts)]
  A <-->|GitHub App user tokens| G[GitHub]
```

Production rooms should be keyed by GitHub installation, repository, branch, and manuscript path. The WebSocket upgrade must validate the signed-in user and current repository permission before joining a room.

A repository-aware preview worker should check out the bound revision, overlay the live manuscript, and run the repository's pinned MyST build. The browser parser remains useful for instant feedback while the authoritative preview builds asynchronously.

## Data Boundaries

- **GitHub:** canonical manuscript versions, branches, reviews, and publication CI
- **Yjs store:** uncommitted collaborative state
- **Session store:** encrypted or server-side GitHub user authorization
- **Preview storage:** disposable build artifacts keyed by source revision
- **Audit store:** room membership, snapshots, and attribution events

## Scaling

One application instance is sufficient for a controlled pilot. Multiple instances require shared persistence and Pub/Sub so users connected to different instances observe the same updates. Cloud Run WebSockets reconnect after their configured request timeout; clients must treat reconnects as normal operation.