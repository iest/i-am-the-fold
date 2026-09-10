# Security audit — 10 September 2026

Audited commit: `20c4538ed3d5a9c8727abada9e3087a99364347b` on `sep-2026-updates`.

The Hono application has credible data-poisoning and resource-abuse weaknesses. No critical or high-severity, remotely exploitable application vulnerability was demonstrated. The most useful fixes are to block framing, bound analytics traffic, and rate-limit submissions before cryptographic work and Redis access. The container runtime and committed backups also need attention before publishing this branch.

This report covers all tracked application code, browser code, build and maintenance scripts, lockfile dependencies, Docker/Fly/GitHub Actions configuration, and reachable local Git history. Verification used fake credentials, fake upstreams, isolated Redis, a real local Chromium browser, and a previously built local container. GitHub and Fly checks were read-only metadata requests. No attack traffic or test writes were sent to the public site, production Redis, or PostHog.

## Findings

Severity reflects impact and reachability in this application, rather than copying dependency advisory scores. “Medium” findings merit remediation before deployment; “Low” findings cover narrower failure conditions or hardening. Availability and billing impact were assessed from bounded reproductions, not a load test.

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| F1 | Medium | A foreign site can submit its chosen iframe height using visitors' browsers | Browser reproduction |
| F2 | Medium | Analytics proxy accepts unrestricted cross-origin uploads and paths | Local HTTP-handler reproduction |
| F3 | Medium | One solved puzzle can repeatedly trigger Redis operations | 20 requests, 20 Redis calls, one puzzle |
| F4 | Medium | Docker pins an outdated Node security patch level | Dockerfile and container inspection |
| F5 | Medium | Raw IP backups are committed and could be published with this branch | Local Git and redacted backup inspection |
| F6 | Low | Cold-cache failures bypass the intended retry backoff | 20 immediate render attempts at one simulated timestamp |
| F7 | Low | Development dependency tree contains known vulnerabilities | npm audit and call-site review |
| F8 | Low | Deployment action code is selected through mutable references | Workflow review |

### F1 — Cross-site framing poisons measurements

Locations: [server/app.tsx](/Users/iest/github/i-am-the-fold/server/app.tsx:29), [client/index.ts](/Users/iest/github/i-am-the-fold/client/index.ts:5), [client/index.ts](/Users/iest/github/i-am-the-fold/client/index.ts:45).

The HTML has no `Content-Security-Policy: frame-ancestors` or `X-Frame-Options`. The browser script automatically measures and submits `window.innerHeight`, including when running inside an iframe. An unrelated site can embed an invisible iframe, choose its height, and let the legitimate client solve the puzzle and submit the fabricated measurement from each visiting IP.

**Verified:** an outer page on `localhost` had a 720px viewport. Its hidden iframe loaded the application on `127.0.0.1` with a height of 1,234px. The real worker solved the challenge and the application accepted `fold: 1234`. The POST correctly contained the application's own Origin and `Sec-Fetch-Site: same-origin`, so existing origin checks do not stop this attack. The database was a local stub; the normal signature, proof, origin, and height checks ran unchanged.

Impact: pollution of the histogram, consumption of visitors' two-week submission allowance, and involuntary proof-of-work CPU usage. An attacker needs traffic to a page they control; this does not defeat Redis's one-write-per-IP rule.

**Fix:** return `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` on the page. Also skip collection when `window.top !== window.self` as a secondary safeguard. The CSP directive must be an HTTP response header. Hono provides middleware for configuring these headers. [Hono secure headers](https://hono.dev/docs/middleware/builtin/secure-headers), [frame-ancestors reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

Acceptance check: the same foreign iframe must be blocked and no challenge request or fold save should occur.

### F2 — Unrestricted analytics relay

Location: [server/app.tsx](/Users/iest/github/i-am-the-fold/server/app.tsx:54).

Every GET or POST under `/ingest/*` is forwarded to a PostHog host. There is no request-size cap, origin validation, route allowlist, project-token restriction, or rate/concurrency limit. The 4KB limit on `/api` does not apply here. The proxy is enabled even when analytics has no configured project key.

**Verified:** a cross-origin `text/plain` POST containing 65,536 bytes to an arbitrary ingest path reached a stub upstream in full. The supplied query parameter naming an unrelated project was preserved. No token, puzzle, or fold validation was required. Real PostHog acceptance was deliberately not tested.

Impact: visitors or scripts can consume application connections, bandwidth, outbound requests, and machine uptime without paying the proof-of-work cost. If PostHog accepts requests bearing the public project key, forged events may also distort analytics and consume its allowance. Streaming and the 15-second timeout limit individual requests, but do not establish an overall traffic budget.

This is **not arbitrary-host SSRF**: the two upstream hostnames are fixed, encoded-slash probes did not change them, and redirects are not followed. Cookies and Authorization are not forwarded, and upstream Set-Cookie is discarded.

**Fix:** disable the proxy when analytics is disabled; allow only the paths/methods actually used by the installed SDK; apply measured upload limits, same-origin checks for browser writes, and per-source plus global rate/concurrency limits. If retaining project checks, validate the supported batch/compression formats against the configured project key without introducing unbounded decompression. Cache static SDK assets or use a managed proxy. The public project key is an identifier, not an authentication secret. [PostHog proxy documentation](https://posthog.com/docs/advanced/proxy).

Acceptance check: oversized or foreign browser writes and unsupported routes are rejected before an upstream request; throttling produces 429 responses; normal SDK ingestion still works.

### F3 — Replayed proofs still incur database cost

Locations: [server/api.ts](/Users/iest/github/i-am-the-fold/server/api.ts:103), [util-server.ts](/Users/iest/github/i-am-the-fold/util-server.ts:80).

Every valid signed challenge/proof reaches Redis, including a challenge already used successfully. The Redis script prevents duplicate increments, but rejection still requires a network operation and script execution. Neither challenge issuance nor submission attempts are rate-limited.

**Verified:** one puzzle was solved once and the identical submission sent 20 times. A stub at the Redis boundary recorded 20 `eval` calls: the first request succeeded and the following 19 returned 403. The separate real-Redis integration test confirms that duplicate writes remain blocked.

Impact: a script can replay within the token's remaining two-minute lifetime at almost no new puzzle-solving cost, generating upstream traffic and potential quota exhaustion. Origin/Fetch-Metadata headers protect browsers from certain cross-origin requests; a direct HTTP client can supply matching headers.

**Fix:** impose cheap per-source and global request budgets before signing, signature verification, and Redis access. Keep the atomic Redis rule as the final correctness check. A bounded, short-lived cache of spent challenges can suppress repeated local Redis calls; it must have a strict size limit and must not replace the shared deduplication rule. Do not make a new Redis lookup on every rejected request the only throttle.

Acceptance check: a burst of replays is rejected before Redis and CPU work, while concurrent valid first submissions still increment once across application instances.

**Proof-of-work difficulty:** retain four leading hexadecimal zeroes until these protections exist. It averages 65,536 hashes per new solution; five zeroes averages 1,048,576, a 16-fold increase. A higher difficulty does not fix replay cost, the analytics relay, or framing, and may increase the browser solver's ten-second timeout rate. Benchmark slow phones before changing it.

### F4 — Outdated Node runtime in the image

Locations: [Dockerfile](/Users/iest/github/i-am-the-fold/Dockerfile:2), [package.json](/Users/iest/github/i-am-the-fold/package.json:38).

Both image stages pin Node `22.17.0`. Inspecting the existing local `i-am-the-fold:hono-check` image confirmed Node `v22.17.0`, bundled Undici `6.21.2`, OpenSSL `3.0.16`, and UID 1000.

Node 22 is a maintained release line, but this patch level omits subsequent security fixes. For example, Node's July 2026 security release shipped 22.23.2 with HTTP parser, TLS, and dependency fixes. npm audit does not inspect Node's bundled libraries or operating-system packages. [Node July security advisory](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases), [22.23.2 release notes](https://nodejs.org/en/blog/release/v22.23.2).

No runtime CVE was demonstrated against this application. HTTP/2, permission-model, mTLS, SQLite, and other advisories should not automatically be described as visitor-exploitable here: this service uses the default HTTP/1 Node adapter behind Fly, and several affected features are unused. This finding is a confirmed patch-management gap, not evidence of remote code execution.

**Fix:** build with the current security-patched Node 22 or 24 LTS release, align CI and the documented runtime floor, rebuild the base image, and arrange regular image/dependency updates. Pin a reviewed image digest with automated update proposals. Run an OS/package image scan as part of that rebuild; a full OS CVE scan was not performed in this audit.

### F5 — Committed backups retain raw IPs

Locations: the two tracked `redis-backup-2025-10-10T15-*.json` files, [scripts/export-redis.ts](/Users/iest/github/i-am-the-fold/scripts/export-redis.ts:163), [.gitignore](/Users/iest/github/i-am-the-fold/.gitignore:1).

Each backup contains two IP-key records, including one globally routable address. The exporter writes raw IPs and TTLs to the repository working directory, and `.gitignore` does not exclude these files. Backup copies persist independently of Redis's two-week expiration. Addresses are intentionally omitted from this report; their ownership was not investigated.

**Exposure status:** the repository is public, but its current default-branch file listing contained neither backup. GitHub did not recognize the local introducing commit `c826438`. These checks establish a local publication hazard, not a confirmed public leak across all branches, forks, or prior shares. The HTTP static handler does not serve the backups, and `.dockerignore` excludes them from the build context.

**Fix before publishing this branch:** remove the raw records from the branch's commits, add an ignore rule, and keep backups outside the repository with restrictive permissions and a retention policy. Merely deleting the latest copies leaves earlier commits intact. History edits should be a deliberate, separate operation. Consider omitting IP locks from exports or using keyed HMAC identifiers for deduplication, with a migration plan and the existing expiry; an ordinary unsalted IP hash is enumerable.

Acceptance check: intended published Git history contains no IP backup data; a new export is ignored or created outside the repository.

### F6 — Cold-cache failure backoff is ineffective

Location: [server/cache.ts](/Users/iest/github/i-am-the-fold/server/cache.ts:29).

On a render failure, `refreshAfter` is set five seconds ahead. However, the cold-cache branch calls `refresh()` whenever `cached === undefined`, without checking that timestamp. After each failed render settles, the next request immediately retries Redis. Warm-cache refreshes correctly honor the backoff.

**Verified:** 20 sequential cold-cache requests at an unchanged fake timestamp caused 20 render attempts. Concurrent requests still coalesce while a render is pending.

Impact: if Redis is failing during startup or after an idle-machine restart, visitor traffic amplifies repeated upstream failures and logs. The attacker cannot create the underlying Redis outage through this bug alone.

**Fix:** honor a retry deadline even without a successful cached page, return a temporary 503 with `Retry-After`, and give Redis operations explicit time budgets. Preserve stale-page serving once a page exists.

### F7 — Vulnerabilities in build-only dependencies

Location: [package-lock.json](/Users/iest/github/i-am-the-fold/package-lock.json:1).

`npm audit --omit=dev` reported **zero** vulnerabilities. The full audit flagged **11 package entries: 8 high, 2 moderate, 1 low**. These are package counts, not 11 independent demonstrated exploits. All affected lockfile entries are development dependencies and the runtime image uses `npm ci --omit=dev`.

| Package | Locked version | npm severity |
| --- | --- | --- |
| brace-expansion | 2.0.1 | High |
| browserslist | 4.23.2 | High |
| cross-spawn | 7.0.3 | High |
| glob | 10.3.10 | High |
| micromatch | 4.0.7 | Moderate |
| minimatch | 9.0.5 | High |
| nanoid | 3.3.7 | High |
| picomatch | 2.3.1 | High |
| postcss | 8.4.40 | High |
| postcss-selector-parser | 6.1.1 | Low |
| yaml | 2.5.0 | Moderate |

Most are reached through Tailwind/PostCSS/Autoprefixer and their file/config parsing. Visitors do not control those inputs in this project. In particular, the build does not invoke the vulnerable `glob --cmd` interface, and PostCSS processes the checked-in CSS file rather than uploaded CSS. [glob advisory](https://github.com/advisories/GHSA-5j98-mcp5-4vw2), [PostCSS advisory](https://github.com/advisories/GHSA-6g55-p6wh-862q).

**Fix:** update the development dependency tree and lockfile, then rebuild, type-check, test, and compare generated CSS. Continue monitoring both production and build dependencies; do not describe a clean production npm audit as a clean runtime/container audit.

### F8 — Mutable deployment action references

Location: [.github/workflows/fly-deploy.yml](/Users/iest/github/i-am-the-fold/.github/workflows/fly-deploy.yml:22).

The deployment setup action uses `superfly/flyctl-actions/setup-flyctl@master`; checkout and setup-node also use movable version tags. Compromise of an upstream reference could alter action code or the installed deployment executable. Although the Fly token is scoped to the later deployment step, an earlier compromised action runs on the same runner and could leave code that captures it then.

There is also no explicit workflow `permissions` declaration. The effective token permissions depend on repository/organization settings and were not verified; this is not a claim that the token currently has write-all access.

**Fix:** pin actions to reviewed full commit SHAs, specify `permissions: contents: read`, use a narrowly scoped Fly deploy token, and disable checkout credential persistence if unused. Automate reviewed pin updates. [GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

## Other operational and hardening observations

- **Deployment branch mismatch:** GitHub reports `master` as the default branch, while the workflow triggers only on `main`. Merging security fixes to the default branch will not trigger this workflow. Align the trigger with the intended release branch and verify a deployment after the fixes are approved.
- **Live version not certified:** Fly metadata still references an image labelled Next.js. Both machines were stopped at inspection time, consistent with the configured autostop policy; that alone is not a vulnerability. The Hono branch and its protections must not be assumed to be live. Exact packages inside the deployed image were not inspected.
- **Production configuration validation:** startup only checks that `SECRET` is nonempty. The local environment uses a short development placeholder and a loopback HTTP Redis endpoint, which is reasonable for local fixtures and is not evidence of insecure Fly secrets. Production startup should reject placeholder signing keys and non-HTTPS remote Redis URLs. Generate a strong random signing key; do not infer production entropy from this local file.
- **Request/upstream budgets:** `/api` bounds byte count but has no short application body-read deadline. Redis is constructed with SDK defaults, including retries, without an explicit operation deadline. Set sensible timeouts and concurrency budgets. A Fly-level slow-client bypass was not tested.
- **Import/export operations:** the utilities take Redis credentials in command-line arguments and allow HTTP URLs. Prefer environment/input handling that avoids shell-history exposure and require HTTPS for remote endpoints. The importer deletes the existing dataset before fully validating and restoring the backup, and restores original TTL durations without accounting for backup age. Validate the entire backup, cap data/TTLs, stage the restore, and preserve expiry semantics. These scripts are operator tools, not HTTP endpoints; no restore was executed during the audit.
- **Browser headers:** add `nosniff`, a deliberate referrer policy, and HTTPS HSTS after checking the domain scope. A broader CSP needs testing with dynamic fold styles, the worker, and PostHog. Missing headers alone were not counted as additional XSS findings; the framing exploit is covered by F1.
- **Limits of anonymous measurements:** valid-range fabricated heights remain possible from a direct HTTP client. Rotating IPs, including IPv6 addresses, can obtain new per-IP allowances; shared NATs can suppress legitimate submissions. Rate limits and carefully chosen network-prefix policies can reduce abuse but cannot prove a real physical viewport. These are design limits, not a bypass of signature verification.
- **Analytics trust:** the PostHog project key is intentionally public. Review enabled capture/replay settings and event quotas in PostHog separately. Same-origin proxying does not make all requests authentic or all upstream responses inherently safe.

## Protections verified

- Fold values must be integers in 1–7680; invalid values are rejected before cryptography or Redis. Stored histogram keys and counts are also validated before rendering.
- The bounded sampler handles empty, corrupt, huge-count, and low-distinct-height datasets without expanding historical counts or looping indefinitely.
- `/api` rejects foreign/missing origins, unexpected content types, oversized UTF-8 bodies, malformed JSON, malformed token/proof fields, invalid signatures, expired tokens, unexpected algorithms, and invalid work.
- JWT verification explicitly permits HS256 only; challenges are random, expire after two minutes, and are returned with `Cache-Control: no-store`.
- Real Redis tests confirm atomic challenge/IP deduplication across DB instances. A failure in the histogram increment does not create the challenge/IP lock keys. Success waits for the write.
- The public page cache contains shared HTML, not private visitor data or challenge tokens. Warm-cache refresh failures preserve the last page, and concurrent renders coalesce.
- Eleven static-path probes, including encoded traversal, malformed paths, `.env`, `.git`, server output, and backup paths, returned 404. The application serves only its public asset directory.
- No visitor-controlled shell execution, template-code evaluation, arbitrary outbound hostname, or demonstrated HTML/script injection path was found in the reviewed handlers.
- The image runs as a non-root user. Secrets and backups are excluded from the Docker build context. The browser build does not contain the known local Redis credential.
- A redacted scan examined 289 reachable local Git blobs under 2MB for common credential patterns and the known local Redis credential, with no matches. This is not proof that every possible unknown secret is absent.
- Fly service metadata uses HTTP/TLS handlers on public ports and forces HTTPS. Trusting Fly's client-IP header is appropriate only while the origin remains behind its proxy; direct Node deployments use the socket address. [Fly request-header documentation](https://fly.io/docs/networking/request-headers/).

## Verification and limits

`npm run lint` passed. `npm test` passed **20/20**, including the real Redis integration test with no skips. Additional local reproductions confirmed F1, F2, F3, and F6. No application implementation or deployment was changed by this audit.

Local evidence is under [output/security-audit](/Users/iest/github/i-am-the-fold/output/security-audit): `checks.mts`, `reproduction-results.json`, `browser-harness.mts`, `iframe-result.json`, both npm audit JSON files, `secret-scan.json`, and Fly metadata. This directory is ignored by Git. The loopback servers and audit browser were stopped afterward.

The audit does not certify the separately deployed legacy image, production secret strength, Redis permissions/network controls, GitHub branch protection/token scopes, PostHog account settings, TLS behavior at the public domain, or OS package CVEs. It did not perform live fuzzing, stress testing, credential cracking, or destructive database tests. These limits prevent source-review findings from being mistaken for verified production compromises.

## Recommended order

1. Remove raw backup data from the commits intended for publication.
2. Block framing; cap and constrain analytics proxy traffic; add early request budgets and replay suppression.
3. Update the Node image and development dependencies, then run the existing checks and regression tests for these findings.
4. Repair cold-cache backoff, strengthen production configuration checks, and harden the workflow and maintenance scripts.
5. Align the deployment branch, deploy the reviewed changes, and verify the public headers and deployed image identity.
