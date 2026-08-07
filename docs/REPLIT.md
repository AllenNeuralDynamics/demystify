# Replit Starter Pilot

Replit Starter can host one free published app for 30 days. Use an Autoscale
deployment with **Max machines set to 1**. DeMystify does not yet synchronize
live Yjs rooms across multiple application instances.

This deployment is suitable only for a short test with synthetic or explicitly
approved non-sensitive manuscripts. Replit hosts published apps and their
production data outside Allen Institute infrastructure.

## Import

Import the public repository at:

```text
https://replit.com/github.com/AllenNeuralDynamics/demystify
```

The repository's `.replit` file configures:

```text
Workspace:   npm run build && HOST=0.0.0.0 PORT=3000 npm start
Build:       npm ci --include=dev && npm run build && npm prune --omit=dev
Production:  HOST=0.0.0.0 PORT=3000 npm start
```

Both workspace testing and publishing use the same single-process topology on
port `3000`; Replit maps that port to its default HTTPS endpoint.

## Database

Open **Database** in the Replit project and enable Replit PostgreSQL. Replit
provides `DATABASE_URL` automatically. When publishing, enable the separate
production database. Do not point a published app at its development database.

DeMystify creates its session, room, and Yjs-update tables at startup.

## Domain And GitHub App

In **Publish**, choose the final `*.replit.app` domain before adding production
secrets. Use the same origin everywhere. For example:

```text
APP_URL=https://demystify-pilot.replit.app
GitHub App homepage=https://demystify-pilot.replit.app
GitHub App callback=https://demystify-pilot.replit.app/api/auth/github/callback
```

Configure a dedicated pilot GitHub App with:

- Contents: read and write
- Pull requests: read and write
- Metadata: read-only
- Webhooks: disabled
- Expiring user authorization tokens: enabled
- Installation limited to selected pilot repositories

## Production Secrets

Development and published-app secrets are separate in Replit. Add these to the
published app without placing their values in source control or chat:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
APP_URL=https://<chosen-domain>.replit.app
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_SLUG=
SESSION_SECRET=
PGPOOL_MAX=10
```

Generate `SESSION_SECRET` from at least 32 random bytes. Replit supplies `PORT`
and `DATABASE_URL`; do not override them.

## Publish

1. Select **Publish** and choose **Autoscale**.
2. Under **Machine configuration**, set **Max machines** to `1`.
3. Use the smallest available machine for the initial test.
4. Confirm the production database and production secrets are enabled.
5. Publish and wait for Provision, Security checks, Build, Bundle, and Promote.
6. If Starter does not permit Max machines `1`, stop rather than testing an
   unsupported multi-instance deployment.

The free published app expires after 30 days and can then be republished.
Autoscale instances can stop and restart by design, so reconnect and persistence
behavior are part of the test.

## Validation

1. Open `https://<chosen-domain>.replit.app/api/health` and confirm
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
- Starter deployments expire after 30 days.
- Autoscale restarts regularly and can have a cold start after inactivity.
- Replit production PostgreSQL is usage-billed, although a small pilot should
  consume little storage and compute.
- Replit's deployment filesystem is not durable; PostgreSQL is required.
- Confirm Allen Institute approval before storing real manuscripts or GitHub
  OAuth tokens with Replit.