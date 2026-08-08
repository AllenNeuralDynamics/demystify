# Replit Pilot

Replit Starter can run DeMystify from a temporary HTTPS development URL while
the project workspace is active. The Starter account tested on August 8, 2026
also provided one free Autoscale publication that expires after 30 days. Replit
shows the expiration date after the first successful publish.

For an Autoscale deployment, set **Max machines to 1**. DeMystify does not yet
synchronize live Yjs rooms across multiple application instances.

This setup is suitable only for a short test with synthetic or explicitly
approved non-sensitive manuscripts. Replit hosts published apps and their
production data outside Allen Institute infrastructure.

## Current Deployment

The validated fresh pilot deployment is:

| Setting | Value |
| --- | --- |
| Replit project | `Jlecoq/Demystify-Deploy` |
| Public URL | <https://demystify-deploy--jlecoq.replit.app/> |
| Deployment type | Autoscale (`cloudrun`) |
| Machine limit | 1 maximum machine (2 vCPU / 4 GiB RAM) |
| Visibility | Public |
| Database | Fresh Replit production PostgreSQL database |
| GitHub App | `demystify-replit-pilot-jl` |
| OAuth callback | `https://demystify-deploy--jlecoq.replit.app/api/auth/github/callback` |
| Free publication expiry | September 7, 2026 |

The Replit project is overlaid from `origin/main` while retaining its generated
artifact manifests. The August 8 republish preserved the existing production
rooms, sessions, and Yjs updates and deployed the collaborator access-recheck
flow. Do not copy the development database over this production database.

## Project Setup

The validated Starter path was to create one minimal **Website** artifact with
Lite Agent, then overlay the public repository from Shell:

```bash
git remote add demystify-origin https://github.com/AllenNeuralDynamics/demystify.git
git fetch --depth=1 demystify-origin main
git checkout demystify-origin/main -- .
npm ci --include=dev
npm run build
```

Use Shell for all subsequent setup. Repeated Agent conversion or workflow
repair is unnecessary and consumes the Starter Agent allowance.

The repository's `.replit` file configures:

```text
Workspace:   npm run build && HOST=0.0.0.0 PORT=3000 npm start
Build:       npm ci --include=dev && npm run build
Production:  HOST=0.0.0.0 PORT=3000 npm start
```

Both workspace testing and publishing use the same single-process topology on
port `3000`; Replit maps that port to its default HTTPS endpoint. Keep build
dependencies installed through Replit's artifact build phase; pruning them in
the root build removes `tsc` before that phase runs.

`deploymentTarget = "cloudrun"` is required. Without it, Replit selected the
subscription-only GCE provider even though the Starter account was authorized
for one free published app using Autoscale or Static.

### Agent-Generated Artifact Routing

The current Agent-native Replit project retains generated artifact manifests.
Its production routing uses the root DeMystify build as the single source of
application code:

```toml
# artifacts/demystify-deploy/.replit-artifact/artifact.toml
[services.production]
build = ["node", "-e", "process.exit(0)"]
serve = "static"
publicDir = "dist"
```

```toml
# artifacts/api-server/.replit-artifact/artifact.toml
[services.production]
paths = ["/api", "/collaboration"]

[services.production.build]
args = ["node", "-e", "process.exit(0)"]

[services.production.run]
args = ["npm", "start"]

[services.production.run.env]
PORT = "8080"
HOST = "0.0.0.0"
NODE_ENV = "production"
```

The root `.replit` build runs before these artifact phases, so both artifact
build commands are intentionally no-ops. The API artifact owns both HTTP API
and WebSocket routes, keeping all stateful traffic on one backend process.

## Database

Open **Database** in the Replit project and enable Replit PostgreSQL if the
import did not create it automatically. Replit provides `DATABASE_URL`. Free
workspace testing uses the development database. When publishing, enable the
separate production database; do not point a published app at development data.

DeMystify creates its session, room, and Yjs-update tables at startup. The
session store performs a harmless lookup during initialization so
`connect-pg-simple` creates `demystify_sessions` before Replit compares the
development and production schemas.

Replit generates a migration by comparing those schemas during publication.
Review that migration before approval. If it proposes dropping
`demystify_sessions`, `demystify_rooms`, or `demystify_yjs_updates`, cancel the
publish and run the current server once against the development database so all
three tables are initialized. Never approve a destructive migration merely to
complete a republish.

## Free Workspace URL And GitHub App

Start the app with **Run**, then copy its `*.replit.dev` URL from Preview. It can
also be printed from Shell without revealing a secret:

```bash
printf '%s\n' "$REPLIT_DEV_DOMAIN"
```

Use that exact HTTPS origin for the temporary test:

```text
APP_URL=https://<current-development-domain>.replit.dev
GitHub App homepage=https://<current-development-domain>.replit.dev
GitHub App callback=https://<current-development-domain>.replit.dev/api/auth/github/callback
```

Development URLs can change when the workspace is reopened. Update `APP_URL`
and the GitHub App callback whenever that happens.

For a published app, choose the final `*.replit.app` domain before adding
production secrets. Use the same published origin everywhere. The current
deployment uses:

```text
APP_URL=https://demystify-deploy--jlecoq.replit.app
GitHub App homepage=https://demystify-deploy--jlecoq.replit.app
GitHub App callback=https://demystify-deploy--jlecoq.replit.app/api/auth/github/callback
```

Configure a dedicated pilot GitHub App with:

- Contents: read and write
- Pull requests: read and write
- Metadata: read-only
- Webhooks: disabled
- Expiring user authorization tokens: enabled
- Installation limited to selected pilot repositories

## Secrets

Add these as **App Secrets** for free workspace testing, without placing their
values in source control or chat:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
APP_URL=https://<current-development-domain>.replit.dev
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_SLUG=
SESSION_SECRET=
PGPOOL_MAX=10
```

Generate `SESSION_SECRET` from at least 32 random bytes. Replit supplies
`DATABASE_URL`. The repository configuration sets the application port.

Development and published-app secrets are separate in Replit. If publishing is
available, add the same keys to deployment secrets and change `APP_URL` to the
final `*.replit.app` origin.

## Publish

The validated Starter account exposes one temporary 30-day publication. If the
Publish panel says **Upgrade your plan to publish**, first confirm that
`.replit` sets `deploymentTarget = "cloudrun"`; GCE requires a subscription,
while Autoscale is included by the Starter entitlement used here. Do not add a
payment method or upgrade without approval.

To publish:

1. Select **Publish** and choose **Autoscale**.
2. Under **Machine configuration**, set **Max machines** to `1`.
3. Use the smallest available machine for the initial test.
4. Confirm the production database and production secrets are enabled.
5. For a republish, leave **Copy your development database to production
   database** disabled; enabling it overwrites production data.
6. Start publishing and inspect any generated database migration. Cancel if it
   drops a DeMystify table or otherwise removes production data.
7. Wait for Provision, Security checks, Build, Bundle, and Promote.
8. If the account does not permit Max machines `1`, stop rather than testing an
   unsupported multi-instance deployment.

Autoscale instances can stop and restart by design, so reconnect and persistence
behavior are part of the test.

## Validation

The August 8, 2026 deployment passed these production checks:

- `/`, `/api/health`, and `/api/config` returned HTTP `200`.
- GitHub OAuth completed through Allen Institute SSO using the stable callback.
- `/collaboration/<room>` reached the DeMystify WebSocket authorization gate.
- Anonymous collaborator and viewer sockets connected successfully.
- Both anonymous roles received HTTP `403` for snapshot mutations.
- A signed-in viewer remained `viewer`; a signed-in collaborator with repository
   write access upgraded to `editor`.
- Revoking the viewer link closed only viewer sockets; revoking the collaborator
   link then closed collaborator sockets.
- Both temporary links were revoked, and no test branch or pull request remained.
- Replit reported the final Autoscale build as `success` with no build in
   progress.
- A later republish retained the existing room, session, and Yjs rows without a
   generated migration, and the production bundle contained the collaborator
   **Recheck access** and pending-invitation guidance.

For ongoing pilot validation:

1. Open `https://<current-origin>/api/health` and confirm
   `{"status":"ok"}`.
2. Sign in through the pilot GitHub App.
3. Open one room in two independent browsers or user accounts.
4. Verify text, cursors, presence, and comments converge in both directions.
5. Leave the room open for at least 30 minutes and verify the WebSocket remains
   connected or reconnects without splitting the users into different states.
6. Load a synthetic MyST file, save a `demystify/*` branch, and create a pull
   request.
7. Restart or republish the app, reopen the same room URL, and verify the draft,
   comments, room binding, and login session were restored from PostgreSQL.
8. Review deployment logs for repeated restarts, WebSocket failures, database
   errors, or multiple application machines.

Do not treat a successful short edit as sufficient. The pilot passes only if
two-user collaboration, reconnect, restart persistence, and GitHub publishing
all work.

## Limitations

- Keep Max machines at `1`; horizontal fan-out is not implemented.
- Free development URLs work only while the workspace is active and may change
   after reopening the project.
- The Starter publication is temporary. Republish it before expiration or move
   to an approved durable hosting plan.
- Autoscale restarts regularly and can have a cold start after inactivity.
- Replit production PostgreSQL is usage-billed, although a small pilot should
  consume little storage and compute.
- Replit's deployment filesystem is not durable; PostgreSQL is required.
- Confirm Allen Institute approval before storing real manuscripts or GitHub
  OAuth tokens with Replit.