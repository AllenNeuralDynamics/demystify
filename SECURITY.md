# Security Policy

## Prototype Status

DeMystify is not yet approved for confidential or regulated manuscripts. Maintainers authenticate with GitHub, and their repository write access is checked on room claims, HTTP mutations, and WebSocket upgrades. Invited Suggestion participants and viewers instead use independent, revocable room capabilities with configurable expiration. The controlled production pilot stores rooms, sessions, and Yjs updates in PostgreSQL, but still runs one application instance without production audit or retention controls.

Maintainer repository-permission revocation is enforced on the next room claim, HTTP mutation, or WebSocket reconnect. An already established maintainer socket is not continuously reauthorized, so the controlled pilot must use short infrastructure timeouts and treat reconnect authorization as the live-editing revocation boundary. Rotating, revoking, or expiring a sharing capability invalidates its guest sessions and closes sockets using that role.

Suggestion participants cannot submit canonical manuscript, bibliography,
configuration, reference, metadata, project-file, suggestion-decision, or Git
changes. They may create attributed suggestion, comment, and reply records
anchored to accepted source. The WebSocket gateway applies every incoming update
to a shadow document, compares protected roots, validates anchors and ownership,
and requires new review records to match the authorized socket actor. It does not
trust a client-supplied author ID. A collaborator may update `workingContent` only
when the room already contains a divergent, initialized checkpoint from the
legacy live-proposal workflow; a new atomic-suggestion room cannot start one.

Anonymous sharing sessions receive a stable random actor ID; GitHub-authenticated
participants use `github:<id>`. New comments and replies must match that actor.
Existing comment and reply bodies may be changed only by their original actor;
everyone with writable room access may reply and may resolve ordinary threads.
Editor sockets use the same ownership validation while retaining canonical,
decision, GitHub-mirror, and repository authority. Direct maintainer edits update
accepted source and may coexist with unrelated atomic suggestions. Git snapshots
remain maintainer-only and are blocked only while a legacy working checkpoint is
unresolved.

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
- Repository-owned GitHub Actions publication builds and least-privilege status integration
- Audit logging and dependency monitoring
- A documented incident and data-retention process