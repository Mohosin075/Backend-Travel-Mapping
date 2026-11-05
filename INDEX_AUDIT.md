# Index audit

## Completed indexing follow-up — 2026-11-05

The configured database `giovafilm-roadtripeado` now has **122 indexes across 28 collections**, up from 109. All 109 original index definitions in the audit snapshot are retained unchanged. Thirteen ordinary, non-unique indexes were added and declared in the matching Mongoose schemas. No document updates, index drops, TTL indexes or new uniqueness constraints were introduced by this work.

An already-running TypeScript backend watcher appears to have applied the schema indexes automatically: the standalone migration preflight found all 13 present and returned zero pending builds. Consequently, the standalone `--apply` command was **not** run. Index-build concurrency and historical lock duration were not measured; this was not a serial migration execution.

The latest read-only audit at `2026-11-05T09:18:33.176Z` checked 18 representative query shapes. All 18 winning plans contain `IXSCAN`; none contain `COLLSCAN` or a separate `SORT`. This includes authenticated review conditions, business reviews, map catalog/place sorting and map-scoped sales. Synthetic IDs and `queryPlanner` were used: these results establish available plans, not production latency, selectivity for every user or load-test results.

Validation: 50 tests passed, TypeScript `tsc --noEmit` passed, and both the public homepage and `/api/api/v1/map?limit=1` returned HTTP 200 after indexing. No application restart or deployment was performed.

Added index keys:

- `users`: `{ lastActiveAt: -1 }`.
- `usageviews`, `usageviewdays`: `{ lastSeenAt: -1 }` on each.
- `payments`: `{ status: 1, createdAt: -1 }` and `{ mapId: 1, status: 1, createdAt: -1 }`.
- `offerredemptions`: `{ offer: 1, redemptionTime: -1 }` and `{ redemptionTime: -1 }`.
- `favourites`: `{ user: 1, createdAt: -1 }`.
- `reviews`: `{ reviewer: 1, createdAt: -1 }`, `{ placeId: 1, createdAt: -1 }`, `{ businessId: 1, createdAt: -1 }`.
- `places`: `{ map: 1, status: 1, createdAt: -1 }`.
- `maps`: `{ status: 1, isActive: 1, createdAt: -1 }`.

Evidence: `index-audit-before.json` preserves the original audit, `index-audit.json` contains the latest audit, and `index-migration-preflight.json` records existing indexes and collection sizes. `scripts/production-index-plan.cjs` is the explicit allowlist. `scripts/apply-production-indexes.cjs` defaults to dry-run, disables automatic schema indexing, checks the database/collection size/conflicts, and only creates missing indexes when explicitly invoked with `--apply`. It never drops indexes or modifies documents. No further apply is necessary for this database.

The historical findings below describe the **before** state. The regex search limitation remains outside this indexing change.

## Original read-only audit

The configured MongoDB database was inspected read-only on 2026-11-05. That initial audit modified neither documents nor indexes, disabled automatic index creation and did not load application models.

## Result

28 collections have 109 indexes, including the mandatory `_id` indexes. Indexing is present but does not fully cover the current queries.

Eleven representative filter/sort shapes were checked with `explain('queryPlanner')` and synthetic IDs. Five winning plans contained `COLLSCAN`; four contained a blocking `SORT`. The offer-redeemers plan contained both, so these counts overlap. These are plan observations, not runtime latency measurements or an execution-statistics benchmark.

## Highest-priority gaps

- **Active users:** a `lastActiveAt` range produced `COLLSCAN`. No index on that field exists. Candidate: `users { lastActiveAt: -1 }`.
- **Recent usage activity:** both `usageviews` and `usageviewdays` produced `COLLSCAN` for a global `lastSeenAt` range. Their existing indexes start with `type, entityId`, which suits per-entity queries but not the global activity query. Candidate on each collection: `{ lastSeenAt: -1 }`.
- **Sales reports:** `payments` with `status: 'succeeded'` and a `createdAt` range produced `COLLSCAN`. Candidate: `{ status: 1, createdAt: -1 }`. Map-scoped reports may additionally warrant `{ mapId: 1, status: 1, createdAt: -1 }` after checking real workload frequency.
- **Offer viewer/redemption drilldown:** `offerredemptions` filtered by `offer` and sorted by `redemptionTime` produced `COLLSCAN` plus `SORT`. The current `{ user: 1, offer: 1 }` index does not cover an offer-only lookup. Candidate: `{ offer: 1, redemptionTime: -1 }`. Global redemption date-range reports should separately evaluate a date-leading index.

## Sorting gaps

- Favorites filtered by user use `user_1` but then sort separately. Candidate: `favourites { user: 1, createdAt: -1 }`.
- Own reviews use `reviewer_1` but sort separately. Candidate: `reviews { reviewer: 1, createdAt: -1 }`.
- Public place reviews use `placeId_1` but sort separately. Candidate: `reviews { placeId: 1, createdAt: -1 }`; evaluate the analogous business index. Authenticated reviews use an Approved-or-own-review condition, so validate that complete query shape before choosing a status-prefixed alternative.

These are candidate additions, not instructions to create all of them blindly. Index ordering should be verified against actual filters, sort order, selectivity and write overhead. See MongoDB's [ESR guideline](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/) and [index-supported sorting](https://www.mongodb.com/docs/v8.0/tutorial/sort-results-with-indexes/).

## Working representative plans

- Per-entity usage lookup uses `type_1_entityId_1_lastSeenAt_-1` without a separate sort.
- Published places on a map use `map_1_status_1`.
- Own routes sorted by update time use `user_1_updatedAt_-1`.
- Geospatial and several notification/subscription indexes are present, but their complete workloads were not benchmarked by this audit.

## Search limitation

Places have a text index, but the existing search builds case-insensitive regular expressions instead of a `$text` query. The text index does not automatically optimize those regex predicates. Even a case-insensitive collation index is not a general solution for `$regex`; see [MongoDB's regex index-use documentation](https://www.mongodb.com/docs/manual/reference/operator/query/regex/). Search needs a separate query/index design review while preserving its English/Spanish matching behavior.

## Evidence and reproduction

- `index-audit.json`: the actual collection index list and summarized winning plans.
- `node scripts/audit-indexes.cjs`: repeat the read-only audit using the configured database. It writes only a local JSON report; it never creates/drops indexes or updates data.

At the time of the original audit, no schema-index migration or production index build had been performed. See the completed follow-up above for the current state.
