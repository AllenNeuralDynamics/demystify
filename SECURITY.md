# Security Policy

## Prototype Status

DeMystify is not yet approved for confidential or regulated manuscripts. The local MVP uses unguessable room URLs as bearer invitations and does not enforce GitHub repository permissions on WebSocket upgrades.

## Reporting

Report suspected vulnerabilities privately through GitHub's **Security → Report a vulnerability** feature once private vulnerability reporting is enabled for this repository. Do not include secrets, private manuscripts, or exploit details in a public issue.

## Credential Handling

- Never commit `.env` files, GitHub client secrets, session secrets, user tokens, or private keys.
- GitHub authorization tokens must remain in server-side sessions.
- Production secrets belong in a managed secret store.
- Personal access tokens are not an accepted authentication mechanism.

## Production Gate

Public deployment requires:

- GitHub-authenticated room membership and repository permission checks
- Durable shared persistence and session storage
- CSRF, rate-limit, and security-header review
- Sandboxed repository preview builds
- Audit logging and dependency monitoring
- A documented incident and data-retention process