# I am The Fold

Source for https://www.iamthefold.com. A Hono application that renders previous
visitors' viewport heights as HTML and marks the current visitor's fold in red.

## Development

Use Node.js **24.21.0** (also recorded in `.node-version`):

```sh
npm ci
npm run dev
```

The development server loads `.env.local`, builds assets, and rebuilds when source
files change. Open http://localhost:3000.

Set these variables in `.env.local` locally or Fly secrets in production:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: Upstash REST credentials.
  Remote Redis endpoints require HTTPS. Loopback HTTP is allowed only outside production.
- `SECRET`: a random signing key. Generate at least 32 random bytes, for example
  with `openssl rand -hex 32`. Production rejects short and obvious placeholder keys.
  The same secret derives private visitor identifiers; rotating it invalidates current
  challenges and changes those identifiers, resetting their deduplication namespace.
- `POSTHOG_KEY` (optional): the public PostHog project key. The existing
  `NEXT_PUBLIC_POSTHOG_KEY` variable is also accepted.
- `PORT` (optional): defaults to 3000.

## How it works

- `server/page.tsx` renders the complete page with Hono JSX. There is no React
  hydration. The HTML cache refreshes every five minutes per process, coalesces
  concurrent renders, and serves the previous page during refreshes. Initial
  failures return 503 with a five-second retry backoff.
- The browser shows the red fold immediately and saves in the background. A worker
  solves proof of work, with four leading hexadecimal zeroes and a ten-second deadline.
  Framed pages do not collect measurements or start analytics; HTTP headers block framing.
- `GET /api` issues an uncached, signed, two-minute challenge. `POST /api` requires
  same-origin JSON, a body of at most 4KB received within three seconds, an integer
  height of 1–7680, a valid signature, and a valid proof.
- Before API work, each process allows a burst of 12 requests per source, refilling
  at six per minute. IPv6 addresses share a /64 request budget. A separate process
  budget allows a burst of 60, refilling at 300 per minute, and at most 32 API requests
  may be in flight. Rejections return 429 with `Retry-After: 10`. Budgets are deliberately
  local and bounded; total capacity scales with the number of Fly machines.
- A bounded two-minute replay cache rejects already accepted/in-flight tokens before
  another database operation. Redis remains authoritative: one Lua script atomically
  prevents challenge reuse and duplicate submissions from an IP for two weeks.
- New Redis visitor locks use keyed HMAC identifiers. Legacy `ip:*` locks are checked
  but not renewed, and naturally expire. No raw IP records are exported.
- Redis calls have a five-second deadline and no automatic retries. The HTTP server
  also limits request duration, connections, and keep-alive reuse.
- Analytics loads after the page and talks directly to PostHog's EU service. There is
  no `/ingest/*` proxy. Blocking tools may block analytics; this has no effect on saving
  folds. The public project key is not an authentication secret.

The HTML has a CSP, frame denial, MIME-sniffing protection, a referrer policy, and
production HSTS scoped to the current host. Inline fold positions are permitted;
script sources are restricted to this origin and PostHog's EU asset host.

## Build and deployment

```sh
npm run build
npm start
```

The build needs no Redis access or application secrets. It emits `dist/server.mjs`
and hashed browser assets in `dist/public`; Fira Mono is bundled locally.

Pushes to **`master`** run checks, npm audit, a Docker build, and a container scan
before a separate job deploys with `flyctl deploy --remote-only`. Pull requests to
`master` and weekly scheduled runs execute checks without deploying. Actions and
container images use immutable references. Dependabot proposes weekly dependency,
Docker, and action updates. Keep `.node-version`, the package engine, and Docker's
Node version aligned when accepting runtime updates; review the pinned Fly CLI and
Trivy scanner versions periodically too.

The production image uses a pinned Distroless Node 24.21.0 runtime as a non-root
user, with production dependencies only and no shell or package manager. Build
tools stay in separate stages.
Fly serves port 3000 through HTTPS in London, checks `/health`, caps concurrent
requests, and permits idle machines to stop. Redis data survives deployments.

Use an app-scoped Fly deploy token for the GitHub `FLY_API_TOKEN` secret. Production
credentials belong in Fly secrets, never in Git. `FLY_APP_NAME` enables trust in
Fly's client-IP and forwarded-protocol headers: keep the origin behind that proxy.
Direct Node deployments use the connection address and ignore forwarded IP headers.

The fixes in this working branch take effect on the public site after deployment;
a local build does not update an existing Fly image.

## Checks

```sh
npm run lint
npm test
npm audit --audit-level=low
```

Tests use fake credentials and an isolated Redis server on a Unix socket. Install
`redis-server` locally to run the integration test. CI sets `REQUIRE_REDIS_TESTS=1`
to fail instead of skipping it. Tests cover validation, signatures, concurrent writes,
replay suppression, request budgets, cache backoff, body timeouts, and backup safety.
The image scan checks OS and library packages and blocks deployment on fixable
advisories of any severity.

## Backups and restores

These utilities read `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the
process environment, not command-line arguments. They do not automatically load
`.env.local`. Use your shell or secret manager to supply credentials without pasting
them into shell history.

```sh
npm run redis:export -- /absolute/path/outside/project/fold-backup.json
npm run redis:import -- /absolute/path/fold-backup.json --replace
```

Create the destination directory first. Exports contain only the histogram, use
private file permissions (0600), refuse to overwrite files, and must be outside the
project directory. Backups are capped at 1MB and validated before use. Apply your
normal private-backup retention policy; the exporter does not delete old backups.

Import requires the explicit `--replace` flag. It validates every height/count,
stages the entire histogram, and atomically replaces `folds`. Existing visitor and
challenge locks are preserved with their original expiry. Legacy version-1 backups
are accepted for their histogram only; their IP records are discarded. An empty
histogram explicitly restores an empty dataset. Stop other maintenance operations
before restoring and verify the selected backup: replacement intentionally replaces
all existing counts, while subsequent visitor writes continue normally.
