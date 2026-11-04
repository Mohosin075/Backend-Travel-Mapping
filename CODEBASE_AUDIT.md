# Frontend/backend audit — 2026-11-05

Scope: the flows in `issue.txt` and their connected API/service paths in this repository and `../frontend_giovafilm_roadtripeado`. This is a source-code and automated-regression audit; production data and live browser/device interactions were not exercised.

## Additional defects fixed in this audit

1. **Business views could be counted twice.** `lib/record-visit.ts` emitted the deduplicated socket event and also POSTed an unconditional REST increment. Removed the extra REST call. The socket service remains responsible for persistence, identity and the counting window.
2. **Revenue could be fabricated.** `src/modules/stats/stats.service.ts` returned hardcoded dashboard revenue and generated mock payments when real payments were absent. Dashboard and report revenue now use actual persisted successful payments, including zero-sales periods. Filtered reports with no matching map cannot fall back to unrelated payments.
3. **Editors could add unassigned places to routes.** `src/modules/route-plan/route-plan.service.ts` treated map editors like unrestricted administrators. Route creation, stop addition and updates now use `verifyEditorEditAccess` for regular places, including country assignments. Purchased maps do not bypass editor assignments. The read-path gap below remains separate.
4. **Business-type places could disappear from Visited Places.** The visit writer chose the reference collection from the display type. A document in `places` with `type: Business` was incorrectly saved under the `business` reference. New visits now reference the collection in which the document was found. Existing malformed records were not migrated.

## Confirmed work still needed

### High priority: enforce place access when returning routes

`src/modules/route-plan/route-plan.service.ts`: `populateRoutePlan`, `getMyRoutePlans`, `getRoutePlanById` and mutation responses populate place details without rechecking the requesting user's current map access. `getRoutePlanById` checks route ownership/public visibility, which is not equivalent to access to each place. A public route or a route saved before an editor loses an assignment can still return populated access/entry-cost fields.

Follow-up: apply a common response sanitizer to every populated route response, using current assignments/purchases. Preserve enough stop identity for editing/removal without returning locked detail. Test public routes, changed assignments and revoked purchases, plus the corresponding frontend behavior.

### High priority: apply anonymous-profile rules to contributors

`src/modules/place/place.service.ts`: list/detail queries populate `discoveredBy` with name/profile/level, without `settings.profileStatus`. `discoveredByName` also stores a contributor name. `src/modules/place/place.controller.ts` returns those fields for accessible places. The review sanitizer in `src/helpers/profilePrivacy.ts` does not cover these fields.

Follow-up: sanitize contributor identity and its cached name for other users, while preserving administrator/owner visibility. Cover both list and detail responses and deleted contributors.

### Medium priority: paginate complete report user lists

`src/modules/stats/stats.service.ts`: both `activeUsersDocs` and `allUsersDocs` still use `.limit(100)`. Counts may exceed the number of accounts available for inspection. The separate entity-viewer drilldown has its earlier full-list fix; these are different lists.

Follow-up: add server-side pagination/search to the active/registered-user inspection UI and API, keeping filters/counts consistent. Avoid merely fetching an unbounded number of users on every polling refresh.

### Data follow-up: existing malformed visits and historical counts

The visit reference fix only affects new writes. Check existing records whose `business` reference resolves to a Place instead of a Business, and prepare a reviewed migration if any exist. Previously inflated business counts cannot be accurately repaired just by changing future tracking. No production migration or counter reset was performed.

### Reporting assumption requiring clarification

The statistics service still calculates `taxesCollected` as 10% of revenue; it does not read recorded tax amounts. Removing mock payments does not make that calculation a verified actual-tax figure. Confirm the intended reporting rule before changing its meaning or stored payment schema.

## Existing issue flows checked

| Flow | Source/test result |
| --- | --- |
| Assigned editors editing draft maps | Assignment helper and managed-map query regression covered |
| Earned prizes and user activity expansion | Earned-only filtering, milestone order and complete activity data covered |
| Entity-viewer/redemption drilldowns | Viewer identities, guest counts, deduplication and stored-viewer list coverage present |
| Dashboard yellow branding | Dashboard orange utility/primary orange-hex scan had no matches; marker accent regression covered |
| Default avatar and country/map camera | Fallback asset and delayed geocoder/geolocation races covered |
| Locked municipality pins and editor place access | Discovery teasers and direct detail API covered; route-read exception listed above |
| Offers country filtering | Saved-map precedence and multilingual country filtering covered |
| Route save/close | Save success/failure, stale responses, read-only navigation and modal mounting covered |
| Held pin dragging and always-open state | Two-second gesture, cancellation and saved checkbox regression covered |
| Live activity and anonymous identities | Authenticated heartbeat and review identity rules covered; contributor exception listed above |
| Draft place save and saved fields | Draft status, translated difficulty/hike time/entry cost/atmosphere covered |
| Place search | Spanish name/address and management deduplication regression covered |
| Routes/visited country filters | Selection restore, ordering, ownership, and filtering before pagination covered |
| Visit points | Mark/unmark preserves points and levels for Place and Business |
| Mobile hamburger menu | Explicit View Profile link removed in source; live viewport check pending |

## Validation

- 59 automated regression tests passed, including four new defect regressions.
- Build/type-check results are reported with the audit delivery.
- Existing suites use mocked database/browser boundaries. Live MongoDB query execution, socket reconnect behavior, production record examples, and real mouse/touch interactions still need integration checks.
- No production deployment, data migration or historical counter modification was performed.
