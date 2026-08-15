# Architecture

## Current Implementation

```mermaid
flowchart LR
  B[React + CodeMirror] <-->|Yjs updates and awareness| W[Express WebSocket server]
  B --> M[MyST parser + KaTeX]
  W <--> L[(LevelDB locally or PostgreSQL)]
  B <-->|HTTP-only session| G[GitHub App gateway]
  G <-->|Contents, pull requests, and comments| R[GitHub repository]
```

The browser binds CodeMirror directly to a shared `Y.Text`. The same Yjs document stores comments, while awareness carries transient cursors and collaborator identities. The Express server handles both API requests and WebSocket upgrades. Every upgrade is authorized from either a maintainer's HTTP-only GitHub session or an active room-scoped sharing grant; maintainer upgrades also recheck repository write access before handing the connection to Yjs. Hidden tabs and visible pages without interaction for 10 minutes disconnect their provider and pause GitHub polling while retaining local Yjs state. Pointer, keyboard, scroll, focus, or visibility activity reconnects the provider, so abandoned tabs do not keep request-based compute active indefinitely.

Sharing has three roles, while GitHub identity is an independent session property. A **maintainer** is authenticated through GitHub and has repository write access. The shareable Maintainer URL is the plain room URL and grants no authority by itself; each maintainer claim and HTTP mutation verifies current repository permission. Established maintainer WebSockets are not continuously reauthorized, so permission changes take effect for live editing at reconnect. **Suggestion mode** uses a room-scoped 256-bit capability and may create attributed suggestion, comment, and reply records without repository access. For each incoming Yjs update, the WebSocket gateway applies the update to a shadow document, verifies protected roots, actor identity, and comment ownership, and rejects canonical source or suggestion-decision mutations. Suggestion users may authenticate with GitHub so that actor becomes `github:<id>`; OAuth does not upgrade their role unless the repository permission check also succeeds. Anonymous share grants receive stable per-session actor IDs and display names. A **viewer** holds an independent capability and may receive awareness and synchronization but cannot submit Yjs updates. Capability secrets live only in URL fragments, are exchanged for versioned HTTP-only room grants, and are stored only as SHA-256 hashes with creation and optional expiration times. Canonical source, suggestion decisions, repository binding, snapshots, pull requests, revisions, sharing administration, and GitHub comment APIs require maintainer access. Both editor and contributor sockets enforce that only a comment or reply author may change its body; all writable roles may add replies. Rotating, revoking, or expiring one capability closes only sockets using that role.

Local development uses LevelDB for Yjs updates, an atomic JSON room registry, and in-memory sessions. When PostgreSQL is configured, one shared pool backs sessions, immutable room ownership and repository bindings, and append-only Yjs updates. With either persistence backend, the server finishes hydration before completing the WebSocket handshake; a room is compacted to one current-state update when its last socket disconnects. Production fails closed if PostgreSQL is absent.

The browser uses the official JavaScript MyST parser for fast, debounced feedback. Rendering is memoized and waits briefly for typing to pause, so comment drafts and unrelated UI changes do not reparse a long manuscript. Safe raw HTML is restored before final DOMPurify sanitization; relative images resolve to committed public-repository assets; iframe directives use static placeholders while retaining editable body captions. The AuthorshipExtractor directive has a built-in static fallback that parses only collaborative repository YAML. This preview intentionally does not execute a repository's full `myst.yml`, remote plugin code, custom styles, or generated-asset pipeline. As a result, repositories using custom plugins, templates, or generated assets must treat their CI build output—not the browser preview—as authoritative.

Room bindings are immutable after their first primary repository file is selected. This prevents an existing socket population authorized for one repository from being silently carried into another project. Repository writers bind Source directly to the accepted `content` Y.Text in Editing, which remains the low-latency live workshop. Suggestion participants instead edit a projected local Source draft or supported Visual block. After a short Source pause, or when a Visual edit finishes, the client writes an attributed suggestion record anchored to accepted source with Yjs relative positions. Multiple non-overlapping suggestions coexist and each receives an independent maintainer decision. The `workingContent`, contributor, and checkpoint roots remain for rooms that already contained an unresolved whole-document live proposal; those rooms must accept or discard that checkpoint before returning to the atomic model. Canonical secondary Markdown sources discovered from MyST exports, TOCs, and recursive includes, plus YAML dependencies referenced by AuthorshipExtractor, are nested Y.Text values in a `projectFiles` Y.Map and remain outside the primary-file Suggesting model. The nearest `myst.yml`/`myst.yaml`, its exact repository path, and the managed bibliography path are shared room state as well.

Publication metadata edits operate directly on standard page frontmatter or the `project` object in the discovered MyST config. The YAML Document model preserves comments, key order, and unrelated configuration. MyST validators, ORCID normalization, and the CRediT taxonomy validate form output. One expected-source check covers the active page and project config, so a stale form cannot partially overwrite either source.

GitHub is updated only through explicit snapshots. The gateway derives the repository, path, base branch, and stable `demystify/<room>` branch from the authorized immutable room binding. The first snapshot writes the manuscript, managed bibliography, MyST config, and discovered secondary sources through one Git tree commit, creates a draft pull request, and persists that review identity on the room. Later snapshots update the same branch and pull request. Legacy rooms discover an existing open PR by their deterministic branch before persisting it.

Every room claim, mutation, and WebSocket upgrade refreshes the persisted PR by number and verifies its repository, head branch, and base branch. A closed or merged PR makes the room terminal. Mutation routes return `409`, and the WebSocket server permits only presence and Yjs sync requests so archived content remains loadable without accepting document updates. Starting the next revision creates a server-generated room with the same manuscript binding and initializes its empty Yjs document from the base-branch file.

Comments, replies, and suggestions remain part of the shared Yjs document. Comment roots store encoded relative positions against accepted source plus quoted context; replies are independent map entries so concurrent replies merge without replacing each other. CodeMirror binds directly to accepted Y.Text in Editing. In Suggesting, it displays the current non-overlapping proposal projection, keeps an unsaved typing burst local, and writes one atomic suggestion after 450 milliseconds without input. Source and Visual use the same anchored suggestion API. Editing an existing projected proposal creates a newer record with explicit supersession links, so review history remains durable while only the latest alternative is projected. Source renders accepted deletions and proposed insertions in place; Visual reconstructs accepted and proposed renderings when a change stays inside a supported MyST block. Each suggestion carries its own author, before/after text, status, decision maker, and decision time. Acceptance applies only that anchored replacement to canonical source; rejection leaves canonical source unchanged. Overlapping proposals that no longer match become conflicted rather than silently overwriting accepted text.

Legacy whole-document checkpoints retain their original server behavior: the server records each actor that changes `workingContent`, and a maintainer accepts or rejects that entire state atomically. Git submission remains blocked only while such a legacy working root diverges. Rotating, revoking, or expiring a share capability closes matching sockets with policy code `1008`; clients stop reconnecting, become read-only, and display the access-ended reason.

Once a room has a persisted pull request, a connected maintainer resolves anchors to source lines and mirrors each queued root through a maintainer-authorized server route. Suggestion-authored records remain durable in Yjs/PostgreSQL while no maintainer is connected. GitHub bodies retain proposer identity, escaped before/after text, current status, decision-maker/time, replies, and hidden idempotency markers even though the maintainer's OAuth identity performs the API call. GitHub accepts native review threads only on PR diff lines; a `422` response falls back to a marked conversation comment containing path, lines, and quote. Accepted and rejected native threads are resolved through GraphQL. Recently active maintainer browsers poll room/review and comment-sync endpoints on focus and every 60 seconds; inactive pages do not poll.

## Production Target

```mermaid
flowchart LR
  U[Maintainers and invited guests] --> A[Cloud Run: web, API, WebSockets]
  A <--> P[(Postgres: Yjs state, rooms, sessions, audit)]
  A <-->|Pub/Sub when scaled| X[(Redis)]
  A <-->|GitHub App user tokens| G[GitHub]
  G --> Q[Repository GitHub Actions]
  Q --> O[(Publication artifacts and diagnostics)]
```

Production rooms should be keyed by GitHub installation, repository, branch, and manuscript path. The current upgrade path validates the signed-in user and current repository permission, and production uses PostgreSQL instead of the local room and session stores.

Each manuscript repository owns its pinned MyST build and runs it in GitHub Actions for the immutable snapshot commit. DeMystify should remain an observer: show check status and links to diagnostics or artifacts without executing repository code. The browser parser remains useful for instant unsnapshotted feedback while repository CI remains authoritative.

## Data Boundaries

- **GitHub:** canonical manuscript versions, branches, reviews, and publication CI
- **Yjs store:** uncommitted collaborative state
- **Session store:** server-side GitHub user authorization in PostgreSQL
- **GitHub Actions artifacts:** disposable publication output keyed by snapshot commit
- **Audit store:** room membership, snapshots, and attribution events

## Scaling

One application instance is sufficient for a controlled pilot. PostgreSQL makes state durable, but multiple instances still require Pub/Sub so users connected to different instances observe the same live updates. Cloud Run WebSockets reconnect after their configured request timeout; clients must treat reconnects as normal operation.