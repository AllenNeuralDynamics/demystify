# Deployment

## Recommended Pilot

Run one containerized DeMystify instance on Cloud Run behind HTTPS:

- Minimum instances: `1`
- Maximum instances: `1`
- Request timeout: `3600` seconds
- GitHub credentials: Google Secret Manager
- Persistent Yjs state and sessions: managed Postgres
- Public domain: for example `demystify.allenneuraldynamics.org`

Serving the frontend, API, and WebSocket endpoint from one origin avoids cross-origin cookies and routing complexity. Firebase Hosting can serve a documentation site, but its 60-second dynamic rewrite timeout should not proxy the collaboration socket.

## Required Environment

```dotenv
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_SLUG=
SESSION_SECRET=
APP_URL=https://demystify.example.org
HOST=0.0.0.0
PORT=8080
```

The GitHub App callback must be `${APP_URL}/api/auth/github/callback`.

## GitHub App Permissions

- Repository contents: read and write
- Pull requests: read and write
- Metadata: read-only
- Webhooks: optional for the pilot

Install the app only on selected manuscript repositories. Every editor signs in separately; effective access is the intersection of the app installation and that user's repository permissions.

## Production Requirements

Before raising the Cloud Run instance limit:

1. Replace local LevelDB with shared durable Yjs persistence.
2. Replace the Express memory session store.
3. Add Redis Pub/Sub or an equivalent cross-instance update channel.
4. Preserve the existing repository checks during HTTP and WebSocket access.
5. Add backups, audit logs, rate limits, metrics, and alerting.
6. Run full MyST builds in an isolated worker with CPU, memory, and time limits.

## Repository-Aware Preview

For complex publications, clone or download the bound GitHub revision into an ephemeral worker, overlay the live manuscript, install only allow-listed dependencies, and run the repository's pinned validation/build command. Never execute arbitrary pull-request code in the trusted API container.