# High-traffic code follow-up

Reviewed against backend `21f5ed8` and frontend `cbe7377` on 18 November 2026.
Hosting information supplied by the owner: GoDaddy Linux VPS, 2 CPU cores and 4 GB RAM.

This is a code change and regression verification, **not a certification of 10,000 concurrent users**. No production deployment, load test, database mutation, index build, customer email or charge was performed.

## Changes

- Notification unread counts now match the existing audience once and group by category/type in one aggregation, replacing three notification count operations and one type aggregation. The separate user/audience lookup remains. Response fields, signup cutoff, personal/broadcast membership, read/archive exclusions, category totals and legacy null/missing types are preserved.
- Discovery name/coordinate normalization is memoized within each request. It retains the existing deduplication, result ordering, pagination, media previews, locked-place redaction and editor/admin behavior. No personalized results or entitlements are cached between requests. This reduces repeated normalization work; it does not remove every nested comparison or shrink the map payload.
- Concurrent 401 responses share one token refresh per Redux store. A late 401 can reuse the already renewed token. Refresh responses cannot overwrite logout or a newer login, and different stores never share refresh tasks. Temporary network, 429 or 5xx refresh failures preserve local authentication; confirmed 401/403 rejection still logs out. Original requests are retried at most once.
- Notification polling pauses in unfocused tabs and refetches on return. Visible-tab polling intervals and socket notification delivery are retained.

No new packages, database fields, indexes, connection-pool defaults, production configuration or deployment workflows were introduced.

## Validation

- 385 tests passed across auth, OTP, promo, checkout, tax, map access/privacy, discovery, notifications and concurrent refresh suites.
- Discovery outputs were compared to the committed baseline for guests, purchasers, admins and map editors, including page/sort/search inputs. These use mocked query results and exercise formatting/deduplication; they do not benchmark MongoDB search or query execution.
- Unread responses were compared to the committed baseline, including legacy categories/types, array-valued categories and read/archive exclusions. The notification query count changes from four to one; the user lookup is additional in both versions.
- The configured MongoDB engine also validated the exact baseline and optimized pipelines using one bounded, collectionless `$documents` aggregation of 13 synthetic rows. The results matched, including audience/read/archive exclusions, missing/null values and legacy array categories. No stored records were read or written; no indexes were changed. This verifies MongoDB operator semantics, not production-data query performance. The summary is in `.tools/notification-mongodb-result.json` at the workspace root.
- A same-account login during an older request is now distinguished from automatic token renewal: only known automatic renewals may replay that older request. The delayed-401 regression test confirms an old mutation is not resent after a fresh login.
- A 100-request simulated expired-token burst verifies one refresh, account isolation and bounded replay. It is not an HTTP throughput benchmark.
- Frontend production build and backend TypeScript check passed.
- Local production-build browser verification passed with intercepted mock backend responses: concurrent protected queries shared one refresh, a hidden tab made no unread poll over a 32-second polling window, returning to the tab refetched notifications, and a temporary 503 preserved authentication. No uncaught browser exception was observed. Its result is recorded in `.tools/high-traffic-browser-result.json` at the workspace root.
- Visibility-based interval cancellation also cancels an already scheduled poll; it does not rely solely on the query library's unfocused flag. Targeted lint checks report no errors; existing header/dropdown warnings remain.
- Older map-access test fixtures were updated to resolve this workspace's frontend directory and exercise its existing asynchronous geocoding helper.

## Still required for a 10,000-visitor target

1. Measure an isolated staging deployment with comparable CPU/RAM, database tier, indexes, dataset and proxy configuration. Ramp traffic and measure p95/p99 latency, 429/5xx, CPU, RSS, event-loop lag, database pool wait/latency and socket connections. Define the visitor journeys and peak request rate before deciding whether it passes.
2. Review the large discovery payload and repeated database reads under that workload. Reducing the existing 1,000-pin request or removing preview fields would alter product behavior, so this patch does neither.
3. Configure caching/compression for suitable public content/assets at the proxy/CDN. Do not publicly cache personalized, payment-return, role-specific or entitlement-specific responses. The request-time homepage currently also handles payment-return parameters.
4. Before adding backend processes/servers, provide a shared session/rate-limit store and Socket.IO adapter. Polling transport requires compatible session affinity ([Socket.IO documentation](https://socket.io/docs/v4/pm2)). The default session store is not intended for production scaling ([Express documentation](https://expressjs.com/en/resources/middleware/session/)). Subscription cron work must run once rather than once per worker. The repository's current process-local stores and cron startup are not a complete multi-node design.
5. Confirm actual VPS memory, database tier/connection limits, PM2 instance count, Nginx/socket limits and monitoring. Increasing the database pool or PM2 workers without this information is not a capacity fix.

## Release procedure

Validate query plans/latency on representative staging data and the real browser-cookie refresh flow, then deploy backend and frontend through the existing release process. Check notification counts/read/archive, promo signup/OTP return, paid-map access, editor assignments and expired-token refresh before expanding traffic. Monitor application and database metrics after release. If a regression appears, revert the specific application-change commit through the normal release process; there is no database migration to undo.
