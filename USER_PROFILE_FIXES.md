# User and mobile issue fixes

The local frontend and backend source changes cover the four requested user/mobile issues. Nothing was deployed and no production data was changed.

- Visited Places and My Routes use a country-only selector. They restore the saved country, recover stale saved map IDs, and cannot switch to an empty/all-country query. Other consumers can still opt into the existing All countries behavior.
- Favorite Places uses the same country selection and persisted selection as other pages. The backend scopes favorites to that country's maps, places, businesses and offers **before** pagination and total counting. Authenticated ownership remains enforced. The UI resets/clamps pagination, reads only the current country's response, and provides a retry state on request failure.
- Place details, the profile overview and Contributions/Reviews use the shared `ReviewItem` layout: profile picture, name, level, date, rating and review text. Own reviews have Edit review at the top right. Existing pending/rejected status and edit flows remain; anonymous community identities are not replaced with the signed-in user's identity.
- The mobile profile drawer uses the dynamic viewport height. Profile content and navigation scroll together inside one scroll area; the close controls and logout footer remain outside that area. The footer reserves safe-area padding.

Double-check fixes: a saved country outside the current page of maps remains selected instead of silently switching to the first available country. Fractional ratings now render the appropriate partial-star fill. An additional component test verifies pagination reset and suppression of the previous country's cached favorites during loading.

Validation: frontend production build and backend TypeScript compilation (`npm run build -- --noEmit`) passed. All 39 tests passed across `user-profile-fixes`, `dashboard-production-fixes`, `dashboard-regressions`, and `premium-place-privacy`.

Browser-based visual/swipe QA could not run because the browser access host was unavailable. Layout structure, review rendering/edit actions, country state and backend filtering were exercised in isolated tests. No authenticated live API or MongoDB integration test was used. Verify the four flows on staging with a signed-in account before production deployment; deploy/rebuild the backend before the frontend so favorites country filtering is available.

The eight existing frontend files were backed up in `user-profile-fixes-originals.zip`; `components/Common/reviews/review-item.tsx` is a new file.
