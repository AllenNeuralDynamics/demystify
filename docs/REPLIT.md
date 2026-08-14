# Replit Pilot

**Last validated:** August 13, 2026

**Deployed application source:** [`beb9267fb8eb97fbb098b5556e218eae3ed8e444`](https://github.com/AllenNeuralDynamics/demystify/commit/beb9267fb8eb97fbb098b5556e218eae3ed8e444)

**Publication status:** Online. Replit release `14fd0c56` was published on
August 13, 2026, with refined inline changes, an actionable Review changes flow,
standard Source selection workflows, discoverable comments and responsive
authoring controls, and immediate read-only handling for revoked sharing access.

Replit Starter can run DeMystify from a temporary HTTPS development URL while
the project workspace is active. The Starter account tested on August 8, 2026
also provided one free Autoscale publication that expires after 30 days. Replit
shows the expiration date after the first successful publish.

For an Autoscale deployment, set **Max machines to 1**. DeMystify does not yet
synchronize live Yjs rooms across multiple application instances.

This setup is suitable only for a short test with synthetic or explicitly
approved non-sensitive manuscripts. Replit hosts published apps and their
production data outside Allen Institute infrastructure.

## Pilot Status

The current pilot deployment is:

| Setting | Value |
| --- | --- |
| Replit project | `jeromelecoq/demystify` |
| Publication | Online; updated August 13, 2026 |
| Public URL | <https://demystify--jeromelecoq.replit.app/> |
| Deployment type | Autoscale (`cloudrun`) |
| Machine limit | 1 maximum machine (2 vCPU / 4 GiB RAM) |
| Database | Retained Replit production PostgreSQL database (29.77 MB at restart) |
| GitHub App | `demystify-replit-pilot-jl` |
| OAuth callback | `https://demystify--jeromelecoq.replit.app/api/auth/github/callback` |
| Application source | `beb9267fb8eb97fbb098b5556e218eae3ed8e444` |
| Replit release | `14fd0c56` |
| Last measured cloud credits (after `fd280947` smoke) | 46% used |
| Free publication expiry | September 9, 2026 |

The Replit project was initially imported directly from `origin/main` and uses
the repository's root `.replit` configuration. Subsequent releases use a guarded
exact-SHA overlay: fetch `origin/main`, assert the full intended SHA, overlay its
tracked files, install from the lockfile, build, and require a clean tracked-tree
comparison before Republish. The production database was initialized empty for
the pilot and now contains the pilot's persistent state.

After an earlier smoke check, the infrastructure graph showed approximately 2%
CPU and memory despite zero completed HTTP requests and no open local production
tabs. The publication was temporarily shut down at 45% cloud-credit usage while
that infrastructure warmth was investigated. Replit later reported zero compute
units during the socket-free diagnostic release despite the warm graph. It also
retained the 29.77 MB production database with zero database compute hours.

Replit uses request-based Autoscale billing on Cloud Run. A non-minimum idle
instance is not kept longer than 15 minutes. Replit charges compute while
requests are served; the underlying Cloud Run lifecycle also treats startup and
graceful shutdown as billable instance time. During the socket-free diagnostic
release, Replit's Resource usage panel reported zero compute units even while
the infrastructure graph still showed a warm container. Do not infer credit
consumption from the infrastructure graph alone.

The explicitly approved restart reused that database without copying or
recreating it. Replit's new-publish form would not attach the retained database
automatically, so its credentials were rotated and the new `DATABASE_URL` was
added as a masked deployment secret. A read-only query confirmed 5 room rows, 5
Yjs update rows, and 29 session rows before publication. Continue monitoring the
instance after idle periods; investigate or unpublish if Resource usage shows
unexplained compute consumption without user traffic.

## Project Setup

The validated Starter path is to import the public GitHub repository directly,
decline Agent changes, and verify the imported tree from Shell:

```bash
git fetch origin main
git diff --quiet origin/main HEAD
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

### Replit Workspace Artifact Routing

Replit retains generated artifact manifests in its project workspace; they are
not tracked application source in this repository. Production routing uses the
root DeMystify build as the single source of application code:

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
APP_URL=https://demystify--jeromelecoq.replit.app
GitHub App homepage=https://demystify--jeromelecoq.replit.app
GitHub App callback=https://demystify--jeromelecoq.replit.app/api/auth/github/callback
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

### Collaboration Socket Diagnostics

Accepted collaboration sockets emit structured `collaboration_socket_open` and
`collaboration_socket_close` log events. Each event includes the active socket
count, access role, browser family, platform, and a process-scoped salted client
fingerprint; close events also include the close code and connection duration.
Open events report the count after the new socket is tracked; close events report
the remaining count after the closed socket is removed.
No room name, user identity, raw address, or full user-agent string is logged.
The fingerprint exists only to correlate reconnects within one server process
and must not be used as an authentication or abuse-prevention signal.

An open event without a corresponding close event explains why Autoscale still
sees a long-lived request. If no open event appears while the instance remains
warm without completed HTTP traffic, investigate Replit's instance-drain path.

HTTP requests still open after 10 seconds emit `http_request_long_running`; a
later completion emits `http_request_end`, while shorter requests emit
`http_request_complete`. These events contain only the method, a broad route
category, active request count, duration, outcome/status, and the same
process-scoped client metadata. Exact paths and path parameters are not logged.
Repeated short events can identify traffic that resets the Autoscale idle clock
without ever becoming a long-running request. If neither socket nor long-request
events appear while the instance exceeds Cloud Run's idle limit, check the
pre-acceptance collaboration upgrade.
Upgrades still waiting after 10 seconds emit `collaboration_upgrade_long_running`
with only the current stage (`session`, `authorization`, or `hydration`); a later
resolution emits `collaboration_upgrade_end`. If none of these three diagnostic
event families appears, the activity is outside the DeMystify process.

GitHub requests and PostgreSQL statements are bounded to 15 seconds, with a
20-second PostgreSQL client fallback. A stalled permission check or room
hydration therefore ends instead of holding an Autoscale request indefinitely.

## Validation

The August 10, 2026 application release from SHA `312c94d44b03f5f36ba3cfe085b1307ed5899fe9`
as Replit release `c0e948f3` passed these production checks:

- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
- Production served the expected `index-BXPO2YEi.js` application bundle.
- Live HTML declared `noindex, nofollow, noarchive`, and `robots.txt` disallowed
   all crawlers.
- Replit kept one maximum Autoscale machine and the production PostgreSQL
   database connected.
- An unauthenticated claim against a retained room returned the expected HTTP
   `401` after the live server successfully read room storage.
- Cloud-credit usage remained at 45% after the bounded production smoke.
- Full unit, integration, accessibility, responsive, visual, and five-project
   browser validation ran locally and in GitHub Actions before publication, not
   against Replit production.

Diagnostic release `55ead814` from application SHA
`9d1383faf79dbbf02f78e70942ad72d79404c98a` additionally established:

- No collaboration socket opened after the replacement process started.
- The previous release stopped when the diagnostic release was promoted.
- Replit reported zero compute units during the initial socket-free idle window.

Subsequent releases narrowed the remaining activity source further:

- Release `c8c27642` logged no accepted collaboration socket and no HTTP request
   open longer than 10 seconds.
- Release `ebbc2fa5` also logged no collaboration upgrade waiting in session,
   authorization, or hydration, ruling out a collaboration upgrade stalled in
   any instrumented DeMystify stage.
- All GitHub requests and PostgreSQL statements are now bounded, so an upstream
   stall cannot keep a collaboration upgrade open indefinitely.
- Release `ef0ec2e4` initially recorded two successful
   `http_request_complete` events in the `application` category: `GET` requests
   lasting 11 ms and 13 ms, seven seconds apart shortly after startup. Their
   client metadata did not match a recognized browser family. These events are
   consistent with platform-generated startup or publication checks, but the
   privacy-safe fields do not identify their source and do not prove that they
   were probes. A control-plane-free observation beginning at
   `2026-08-11T06:19:06Z` recorded no HTTP, collaboration-upgrade, or
   collaboration-socket event through `2026-08-11T06:34:31Z`.

The release emitted no shutdown event during that traffic-free interval. A
single health request at `2026-08-11T06:35:25Z` returned in 0.36 seconds, spent
2 ms inside the already-running application, and produced no new startup event.
This proves the process remained physically warm beyond the documented idle
window even though no request reached DeMystify. Replit still reported zero
compute units and cloud-credit usage remained at 45%. The remaining discrepancy
is therefore platform-side instance retention or internal activity outside the
DeMystify process, not an application traffic leak. It is not evidence of
ongoing compute charges under the observed request-based billing state.

The August 11, 2026 feedback release `d7dc25c7` from application SHA
`82b3fd010a603f2335c3e452edd2cb8853becee1` passed these release checks:

- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
- Production served the expected `index-DiLyObOF.js` application bundle with
   the noindex meta policy and crawler disallow file intact.
- At a 900 px viewport, the deployed Comments and Source/Split/Visual controls
   did not overlap and the document had no horizontal overflow.
- Local and protected GitHub validation passed 167 unit/server tests, authenticated
   collaboration integration, lint, build and bundle budgets, dependency audit,
   and 44 executed Playwright checks across desktop and mobile projects.

The August 12, 2026 attributed-suggestions release `3f72b6f5` from application
SHA `0c89cf744f5a792140e1c664eee5dec096be0727` passed these release checks:

- Protected pull request #15 passed strict required `validate` and `browser`
   checks before merging to `main`.
- The Replit workspace fetched `origin/main`, verified the full target SHA,
   switched to that detached commit, installed from the lockfile, built the
   client and server, required clean tracked and staged diffs, and emitted
   `DEPLOY_PREP_OK=0c89cf744f5a792140e1c664eee5dec096be0727` before republish.
- Replit reported success for Provision, Security checks, Build, Bundle, and
   Promote. Autoscale remained 2 vCPU / 4 GiB with one maximum machine, and the
   retained production database remained connected; no development-database copy
   or destructive migration was selected.
- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
   Production served `index-DsC-CAHm.js`, which contains the Source and Visual
   attributed-suggestion implementations. The HTML retained
   `noindex, nofollow, noarchive`, and `robots.txt` continued to disallow all
   crawlers.
- The live anonymous shell loaded with the expected unauthenticated room claim
   (`401`). At 1100x800 and 390x844 viewports, the workspace and toolbar remained
   inside the viewport with no horizontal overflow, and Source/Split/Visual
   controls remained available.
- Local and protected validation passed 177 unit/server tests, authenticated
   collaboration integration, lint, build and bundle budgets, dependency audit,
   and 46 executed Playwright checks across Chromium, Firefox, WebKit, Mobile
   Chrome, and Mobile Safari, with 49 intentional project-specific skips.

The August 12, 2026 composable-suggestions release `72b622a5` from application
SHA `427cf1e544d2eff288b75e762eb7b5e35b8c039c` passed these release checks:

- Protected pull request #17 passed strict required `validate` and `browser`
   checks before squash-merging to `main`.
- The Replit workspace fetched `origin/main`, verified the full target SHA,
   switched to that detached commit, installed from the lockfile, built the
   client and server, required clean tracked and staged diffs, and emitted
   `DEPLOY_PREP_OK=427cf1e544d2eff288b75e762eb7b5e35b8c039c` before republish.
- The destructive development-to-production database copy remained disabled.
   Replit reported success for Provision, Security checks, Build, Bundle, and
   Promote. Autoscale remained 2 vCPU / 4 GiB with one maximum machine, and the
   retained production database remained connected.
- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
   Production served `index-CLsWXs48.js`, which contains local Source drafting,
   explicit proposal submission, overlap conflict handling, and successive
   revision controls. Crawler exclusion remained enabled.
- The live anonymous shell loaded with its expected unauthenticated room claims.
   At 1560 px desktop and 390x844 mobile viewports, the document had no
   horizontal overflow, page exceptions, or server `5xx` responses.
- Local and protected validation passed 187 unit/server tests, authenticated
   PostgreSQL collaboration integration, lint, client/server builds, bundle
   budgets, dependency audit, and 52 executed Playwright checks across Chromium,
   Firefox, WebKit, Mobile Chrome, and Mobile Safari, with 63 intentional
   project-specific skips.

The August 13, 2026 unified-current-proposal release `fd280947` from application
SHA `de1b2968870ac3314447d1f6fe0afae46074c479` passed these release checks:

- Protected pull request #19 passed strict required `validate` and `browser`
   checks before squash-merging to `main`.
- The Replit workspace fetched `origin/main`, verified the full target SHA,
   switched to that detached commit, installed from the lockfile, built the
   client and server, required clean tracked and staged diffs, and emitted
   `DEPLOY_PREP_OK=de1b2968870ac3314447d1f6fe0afae46074c479` before republish.
- The destructive development-to-production database copy remained disabled.
   Replit reported success for Provision, Security checks, Build, Bundle, and
   Promote. Autoscale remained 2 vCPU / 4 GiB with one maximum machine, and the
   retained production database remained connected.
- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
   Production served `index-aaHIaGzC.js`, which contains the one-current-proposal
   workflow, earlier-revision Review history, and maintainer-acceptance boundary.
   Crawler exclusion remained enabled.
- The live anonymous shell loaded with its expected unauthenticated room claims.
   At 1560x900 desktop and 390x844 mobile viewports, the document had no
   horizontal overflow, page exceptions, or server `5xx` responses.
- Local and protected validation passed 195 unit/server tests, authenticated
   PostgreSQL collaboration integration, lint, client/server builds, bundle
   budgets, dependency audit, and 52 executed Playwright checks across Chromium,
   Firefox, WebKit, Mobile Chrome, and Mobile Safari, with 63 intentional
   project-specific skips.

The August 13, 2026 live-Suggesting release `a85d2313` from application SHA
`d7e045f8ca78ab59d64e844d5f9d531716a74e0c` passed these release checks:

- Protected pull request #21 passed strict required `validate` and `browser`
   checks before squash-merging to `main`.
- The Replit workspace fetched `origin/main`, verified the full target SHA,
   switched to that detached commit, installed from the lockfile, built the
   client and server, required clean tracked and staged diffs, and emitted
   `DEPLOY_PREP_OK=d7e045f8ca78ab59d64e844d5f9d531716a74e0c` before republish.
- The destructive development-to-production database copy remained disabled,
   and no database migration prompt appeared. Replit reported success for
   Provision, Security checks, Build, Bundle, and Promote. Autoscale remained
   2 vCPU / 4 GiB with one maximum machine, and the retained production database
   remained connected.
- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
   Production served `index-B5-g83RX.js`, which contains the live attributed
   Suggesting, current live proposal, and unresolved-proposal Git guard. The HTML
   retained `noindex, nofollow, noarchive`, and `robots.txt` continued to disallow
   all crawlers.
- The live anonymous shell loaded with its expected unauthenticated room claim,
   and an anonymous snapshot attempt was rejected with HTTP `401` before any
   mutation. At 1560x900 desktop and 390x844 mobile viewports, the document had
   no horizontal overflow, page exceptions, or server `5xx` responses, and the
   Source/Split/Visual controls remained available.
- In the retained synthetic acceptance room, an authenticated maintainer created
   temporary Suggestion and Viewer links. A reviewer proposal converged into the
   read-only Viewer source with reviewer attribution, the authenticated snapshot
   endpoint rejected the pending proposal with HTTP `409`, and an authenticated
   rejection removed the marker from both clients. Both links were then revoked
   with HTTP `204`, and the room reported no active sharing links.
- Local and protected validation passed 221 unit/server tests, authenticated
   PostgreSQL collaboration integration, lint, client/server builds, bundle
   budgets, dependency audit, and 52 executed Playwright checks across Chromium,
   Firefox, WebKit, Mobile Chrome, and Mobile Safari, with 63 intentional
   project-specific skips.

The August 13, 2026 inline-Suggesting release `6262f34e` from application SHA
`d72a9802539dafde201fd859f685f5dbee851332` passed these release checks:

- Protected pull request #23 passed strict required `validate` and `browser`
   checks on exact head `1a87fead45a82e18f1a2eab21f8676eefff2c889` before
   squash-merging to `main`.
- The Replit workspace fetched `origin/main`, verified the full target SHA,
   switched to that detached commit, installed from the lockfile, built the
   client and server, required clean tracked and staged diffs, and emitted
   `DEPLOY_PREP_OK=d72a9802539dafde201fd859f685f5dbee851332` before republish.
- Replit's saved no-options redeploy path omitted the destructive development
   database-copy input, and no database migration prompt appeared. Replit
   reported success for Provision, Security checks, Build, Bundle, and Promote.
   The Cloud Run build had an image tag, Autoscale retained one maximum machine,
   and the retained production database remained connected.
- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
   Production served `index-C_sGzARs.js` with stable atomic hunk, inline deletion,
   and Review-card markers, plus `MystPreview-CB9DBiMs.js` with the Visual
   accepted/proposed block projection. Crawler exclusion remained enabled.
- The live anonymous shell loaded, and an anonymous snapshot attempt against the
   retained synthetic acceptance room was rejected with HTTP `401` before any
   mutation. At 1560x900 desktop and 390x844 mobile viewports, the document had
   no horizontal overflow, page exceptions, or server `5xx` responses, and the
   Source/Split/Visual controls remained available.
- Local and protected validation passed 227 unit/server tests, authenticated
   PostgreSQL collaboration integration, lint, client/server builds, bundle
   budgets, dependency audit, and 52 executed Playwright checks across Chromium,
   Firefox, WebKit, Mobile Chrome, and Mobile Safari, with 63 intentional
   project-specific skips.

The August 13, 2026 reviewer-feedback release `14fd0c56` from application SHA
`beb9267fb8eb97fbb098b5556e218eae3ed8e444` passed these release checks:

- Protected pull request #25 passed strict required `validate` and `browser`
   checks on exact head `55cbeb42dff767cfb85cfb0f8a0148ebdb7f7c0a` before
   squash-merging to `main`. The resulting protected `main` SHA passed its own
   post-merge workflow.
- The Replit workspace fetched `origin/main`, verified the full target SHA,
   switched to that detached commit, installed from the lockfile, built the
   client and server, required clean tracked and staged diffs, and emitted
   `DEPLOY_PREP_OK=beb9267fb8eb97fbb098b5556e218eae3ed8e444` before republish.
- Replit's saved no-options redeploy path omitted the destructive development
   database-copy input, and no database migration prompt appeared. Replit
   reported success for Provision, Security checks, Build, Bundle, and Promote.
   Build `14fd0c56-97a6-4b00-a22f-8478ef6f85ea` used Cloud Run with an image
   tag, one maximum machine, and the retained production database connected.
- `/`, `/api/health`, `/api/config`, and `/robots.txt` returned HTTP `200`.
   Production served `index-wPZG7xs_.js` with Review changes, Accept all,
   Discard all, access-revocation, comment-discovery, and More-menu markers, plus
   `MystPreview-mteHA47e.js` with Visual suggestion and keyboard-review markers.
   Crawler exclusion remained enabled.
- The live anonymous shell loaded, and an anonymous snapshot attempt against the
   retained synthetic acceptance room was rejected with HTTP `401` before any
   mutation. At 1560x900 desktop, 1180x700 constrained desktop, and 390x844
   mobile viewports, the document had no horizontal overflow, page exceptions,
   or server `5xx` responses. Source/Split/Visual remained available, and the
   constrained More menu exposed all six expected commands.
- Local and protected validation passed 230 unit/server tests, authenticated
   PostgreSQL collaboration integration, lint, client/server builds, bundle
   budgets, dependency audit, and 55 executed Playwright checks across Chromium,
   Firefox, WebKit, Mobile Chrome, and Mobile Safari, with 75 intentional
   project-specific skips.

The initial full role and integration validation on August 8, 2026 additionally
passed these checks against the same pilot environment:

- GitHub OAuth completed through Allen Institute SSO using the stable callback.
- `/collaboration/<room>` reached the DeMystify WebSocket authorization gate.
- Suggestion-mode and viewer sockets connected successfully.
- Suggestion edits and contributor-authored comments converged; viewer writes were rejected.
- Both link roles received HTTP `403` for snapshot and GitHub comment mutations.
- Revoking the viewer link closed only viewer sockets; revoking the Suggestion
   link then closed Suggestion sockets.
- Both temporary links were revoked, and no test branch or pull request remained.
- Replit reported the final Autoscale build as `success` with no build in
   progress.
- Production uses one maximum Autoscale instance. Hidden tabs and visible pages
   idle for 10 minutes disconnect Yjs and pause polling; meaningful activity
   reconnects them so abandoned browser tabs do not hold compute active.

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
- The Starter publication is temporary. Keep cloud-credit monitoring active and
   unpublish if Resource usage shows unexplained compute consumption.
- Autoscale instances may stop after inactivity and restart on later traffic,
   causing a cold start.
- Replit production PostgreSQL is usage-billed, although a small pilot should
  consume little storage and compute.
- Replit's deployment filesystem is not durable; PostgreSQL is required.
- Confirm Allen Institute approval before storing real manuscripts or GitHub
  OAuth tokens with Replit.