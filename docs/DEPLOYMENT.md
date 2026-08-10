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

## Production Environment

These application settings are required in production:

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

PostgreSQL is also required in production. Configure either one connection URL:

```dotenv
DATABASE_URL=postgresql://demystify:password@host/demystify
PGPOOL_MAX=10
```

or the standard PostgreSQL variables. Cloud Run with Cloud SQL normally uses `PGHOST=/cloudsql/PROJECT:REGION:INSTANCE`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`; `PGPOOL_MAX` is optional and defaults to the application's configured pool size.

Production startup fails unless PostgreSQL and `SESSION_SECRET` are configured. The application creates `demystify_sessions`, `demystify_rooms`, and `demystify_yjs_updates` automatically.

## Build And Deploy

The multi-stage `Dockerfile` builds the Vite frontend and emitted Node server, removes development dependencies, and runs on a distroless Node 22 image as an unprivileged non-root user. `cloudbuild.yaml` builds it, pushes it to Artifact Registry, and deploys Cloud Run with a 3600-second request timeout and exactly one instance.

Before submitting the build:

1. Create an Artifact Registry Docker repository and a PostgreSQL Cloud SQL instance.
2. Create the `demystify` database and database user.
3. Add the five Secret Manager values referenced by `cloudbuild.yaml`.
4. Give the Cloud Run service account Secret Manager access and the Cloud SQL Client role.
5. Give the Cloud Build service account permission to push images and deploy Cloud Run.

Then replace the placeholder substitutions at submission time:

```bash
gcloud builds submit \
	--config cloudbuild.yaml \
	--substitutions _REGION=us-west1,_CLOUD_SQL_INSTANCE=PROJECT:us-west1:INSTANCE,_APP_URL=https://SERVICE-URL
```

Set the final Cloud Run URL as the GitHub App homepage and `${APP_URL}/api/auth/github/callback` as its callback. A custom domain can replace the generated URL later.

## GitHub App Permissions

- Repository contents: read and write
- Pull requests: read and write
- Metadata: read-only
- Webhooks: optional for the pilot

Install the app only on selected manuscript repositories. Every editor signs in separately; effective access is the intersection of the app installation and that user's repository permissions.

## Production Requirements

Before raising the Cloud Run instance limit:

1. Add Redis Pub/Sub or an equivalent cross-instance Yjs update channel.
2. Preserve the existing repository checks during HTTP and WebSocket access.
3. Add backups, audit logs, rate limits, metrics, and alerting.
4. Run full MyST builds in an isolated worker with CPU, memory, and time limits.

## Repository-Aware Preview

For complex publications, clone or download the bound GitHub revision into an ephemeral worker, overlay the live manuscript, install only allow-listed dependencies, and run the repository's pinned validation/build command. Never execute arbitrary pull-request code in the trusted API container.