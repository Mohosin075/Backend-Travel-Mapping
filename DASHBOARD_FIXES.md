# Dashboard issue fixes

Local changes cover the four Dashboard items in `issue.txt`. No deployment or live database changes were performed.

- Viewer counts now mean **recorded unique viewers**, and the count button opens every identified account for that entity and date filter. Guests and unavailable accounts are counted separately. Existing lifetime view counters remain visible separately as total views; they are not presented as a count of people.
- New daily usage records preserve reporting periods when somebody visits again. Existing lifetime records are included without duplication. Earlier visits that were never retained cannot be reconstructed, and the report explains that limitation.
- Authenticated activity sends immediately, every 30 seconds while visible, and when the tab becomes visible. HTTP supports token refresh and works without sockets. Socket notifications refresh admin reports after a one-second debounce, with the existing 30-second polling fallback. Private/anonymous profile preferences do not mask names or emails on admin-only report endpoints. Invalid account tokens cannot silently become guest visits.
- Holding a pin for two seconds arms dragging. The editor opens after the pointer is released, with complete place details and the new coordinates; dragging itself does not open it. Tap and cancelled-drag behavior remain separate. Coordinates still require Save to persist.
- Place search matches English/Spanish names and stone/rock/piedra, written/escrita variants, including significant-word searches. Existing filters, publication rules and editor assignment checks remain enforced.

Double-check fixes: existing places cannot be saved until their full details load successfully; missing or mismatched records show Retry instead of an editable discovery record. Delayed tracking failures are discarded after an account switch/logout, while token refresh for the same account still permits fallback. Authenticated activity/usage rate limits are keyed by verified account so users sharing an IP cannot consume each other's heartbeat allowance.

Validation: backend `npm run build` (rechecked with `-- --noEmit`), frontend `npm run build`, and 29 tests across `dashboard-production-fixes`, `dashboard-regressions`, and `premium-place-privacy` passed. Tests exercise mocked storage/transports, pointer events, loading/failure Save protection, preservation of existing content when moving a pin, account-switch tracking and per-account rate-limit keys. No authenticated browser session or live MongoDB integration test was used.

Deployment: deploy the backend before the frontend, then check an admin viewer drilldown, a private user's login/view, the written-stone search and a saved pin drag on staging. The reporting aggregation requires MongoDB 4.4 or newer (`$unionWith`). `UsageViewDay` is an additive collection with a deterministic unique primary key; there is no destructive data migration. Index creation is additive rather than `syncIndexes`.

The frontend's original 12 source files are saved in `dashboard-fixes-originals.zip` in this backend workspace.
