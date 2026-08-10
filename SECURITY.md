# Security Policy

## Prototype Status

DeMystify is not yet approved for confidential or regulated manuscripts. Maintainers authenticate with GitHub, and their repository write access is checked on room claims, HTTP mutations, and WebSocket upgrades. Invited Suggestion participants and viewers instead use independent, revocable room capabilities with configurable expiration. The controlled production pilot stores rooms, sessions, and Yjs updates in PostgreSQL, but still runs one application instance without production audit or retention controls.

Maintainer repository-permission revocation is enforced on the next room claim, HTTP mutation, or WebSocket reconnect. An already established maintainer socket is not continuously reauthorized, so the controlled pilot must use short infrastructure timeouts and treat reconnect authorization as the live-editing revocation boundary. Rotating, revoking, or expiring a sharing capability invalidates its guest sessions and closes sockets using that role.

## Reporting

Report suspected vulnerabilities privately through GitHub's **Security → Report a vulnerability** feature, which is enabled for this repository. Do not include secrets, private manuscripts, or exploit details in a public issue.

## Credential Handling

- Never commit `.env` files, GitHub client secrets, session secrets, user tokens, or private keys.
- GitHub authorization tokens must remain in server-side sessions.
- Production secrets belong in a managed secret store.
- Personal access tokens are not an accepted authentication mechanism.

## Production Gate

Public deployment requires:

- Durable shared persistence and session storage
- CSRF, rate-limit, and security-header review
- Sandboxed repository preview builds
- Audit logging and dependency monitoring
- A documented incident and data-retention process