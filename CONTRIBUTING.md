# Contributing

DeMystify is an early research tool. Focus changes on safe collaborative MyST editing and repository review workflows.

## Local Setup

```bash
npm install
npm run dev
```

The web application runs at `http://localhost:5173`; the API and WebSocket server run at `http://127.0.0.1:8787`.

## Before Opening a Pull Request

```bash
npm test
npm run test:collaboration
npm run lint
npm run build
npm audit --omit=dev
```

The collaboration test launches an isolated server, rejects unauthorized sockets, and verifies two authenticated clients converge.

## Pull Requests

- Keep each change focused and explain the user-facing workflow it affects.
- Add tests for collaboration, authorization, persistence, or serialization behavior.
- Preserve lossless MyST source; do not flatten directives into generated HTML.
- Treat repository content as untrusted input.
- Do not add credentials, tokens, manuscript data, or local Yjs databases to Git.
- Include screenshots for visible interface changes at desktop and mobile widths.

## Architecture Changes

Changes to authentication, room authorization, GitHub permissions, persistence, or preview execution must include a short threat analysis in the pull request. Prefer established Yjs and MyST libraries over custom protocol or parser implementations.