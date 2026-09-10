# I am The Fold

Source for https://www.iamthefold.com. A Hono application that renders previous
visitors' viewport heights as HTML and marks the current visitor's fold in red.

## Development

Use Node.js 22.17 or later:

```sh
npm ci
npm run dev
```

The development server loads `.env.local`, builds the assets, and rebuilds and
restarts when server, browser, or styling source files change. Open
http://localhost:3000.

Set these environment variables in `.env.local` locally or Fly secrets in production:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: Upstash REST credentials.
- `SECRET`: a strong random secret for signing two-minute proof-of-work challenges.
- `POSTHOG_KEY` (optional): the public PostHog project key. The existing
  `NEXT_PUBLIC_POSTHOG_KEY` variable is also accepted. Analytics uses the EU hosts.
- `PORT` (optional): defaults to 3000.

## How it works

- `server/page.tsx` renders the complete page using Hono JSX. React and hydration
  are not needed. `server/cache.ts` caches the rendered HTML for five minutes per
  process, coalesces concurrent renders, and serves the previous page while refreshing.
- `client/index.ts` measures `window.innerHeight`, shows the red line immediately,
  and saves the measurement in the background. `client/worker.ts` solves the
  proof of work; analytics loads separately after page load.
- `server/api.ts` provides `GET /api` for uncached challenges and `POST /api` for
  submissions. It enforces same-origin JSON, a 4 KB body limit, integer viewport
  heights, signed challenge expiry, and proof verification.
- `util-server.ts` samples the Redis histogram without expanding its full history.
  One Redis script atomically prevents challenge/IP reuse and records the fold.
- `server/app.tsx` serves assets, `/health`, and the PostHog `/ingest/*` proxy.
  Only Fly deployments trust Fly's client-IP and forwarded-protocol headers;
  direct Node deployments use the connection address.

## Build and deployment

```sh
npm run build
npm start
```

The build uses esbuild and Tailwind, outputs `dist/server.mjs` plus hashed assets
under `dist/public`, and needs no Redis access or application secrets. Fira Mono
is bundled locally. The server loads its asset manifest at startup.

Pushes to `main` run the checks in `.github/workflows/fly-deploy.yml`, then deploy
with `flyctl deploy --remote-only`. The Docker image runs Node as a non-root user
and includes only production dependencies and the build output. `fly.toml` keeps
the app in London, serves port 3000 through HTTPS, and permits machines to stop
when idle. Redis is external, so measurements survive deployments and restarts.

The public PostHog key is configured as a runtime variable in `fly.toml`.
`FLY_APP_NAME`, set by Fly, enables trust in its HTTP proxy headers. Keep the
Node origin behind that proxy when deploying on Fly.

## Checks

```sh
npm run lint
npm test
```

`lint` performs strict TypeScript checking. Tests build the assets, use fake
credentials, and never connect to the live database. The atomic-write integration
test starts an isolated Redis server on a Unix socket; install `redis-server`
locally to run it (otherwise that test is skipped).

The Redis export/import utilities remain available through `npm run redis:export`
and `npm run redis:import`. Import replaces the target dataset; inspect its
arguments before running it.
