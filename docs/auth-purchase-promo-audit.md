# Auth, map purchase and promo follow-up audit

This is a local source review plus executable tests. No production deployment, live charge, customer email or production database write was performed.

## Problems found and fixed

- Login-to-OTP lost the return destination. The login/forgot-password/signup/OTP/password-setup/Google paths now retain the selected purchase or promo/map destination.
- Promo success trusted `success=true`. It now verifies a payment belonging to the authenticated account and promo code, then runs server-side Stripe fulfilment. Older return URLs without a session ID can recover through that account's payment record.
- An unverified purchase account could match a recipient-only promo by typing its email. Recipient-only free/paid promos now require email ownership verification or Google verification. Public promos retain their normal signed-in behavior. Promo visitors still use the original login/register flow.
- Free promo consumption and map access were separate writes. They now commit together; a failed access grant leaves the promo available to retry.
- Paid promos could create multiple chargeable sessions. One promo now reserves a user/map checkout for up to 23 hours; the same user resumes it, and requests reuse the Stripe key and unique payment upsert. Before another user can take over an expired reservation, the old unpaid session expires. A paid session is fulfilled instead of creating another charge. This reservation is persisted in additive fields; recipient matching still applies.
- Generic promos had no map-selection UI. Selection and pagination are now provided; the selected map survives authentication and payment cancellation. Client input cannot override a map bound to a promo.
- A signup OTP could be reused as password-reset proof. OTP and reset-token consumption are now atomic and single-use, including concurrent requests. Password recovery for an unverified account correctly returns password setup.
- Refresh used stale token permissions without checking the account. It now checks the active database account and current role; the frontend updates the cached role. Inactive Google accounts cannot be recreated through social login.
- Production cookie scope differed across login/OTP/logout. Cookie set/clear now uses matching secure, HttpOnly, SameSite settings. Promo account switching performs server logout before clearing client state.
- Login and OTP could retain a previous account's cached API data. Successful authentication clears that cache and persists the new login before navigation. Return paths reject external and backslash redirects.
- Opening a newly purchased map could keep an older saved map ID. Purchase navigation now saves the new map ID explicitly.

## Exercised cases

| Area | Automated cases |
| --- | --- |
| New buyer | Account before Stripe; no early auth token; normalized email; hashed capability; same-tab retry; absent/expired/wrong capability; verified payment login; saved map selection |
| Existing buyer | Correct/incorrect password; unverified login; existing Google-only/password account; role/profile preservation; existing map ownership; resume after login |
| Recovery | Signup verification; invitation first password; guest/ordinary forgotten password; wrong/expired/missing-expiry OTP; concurrent OTP/reset; consumed reset token |
| Authentication | Secure cookie set/clear; OTP without refresh cookie; remember-me forwarding; current-role refresh; inactive/deleted refresh; inactive Google login; safe internal redirects; cache reset and persistence |
| Free promo | Verified recipient; unverified guest blocked; wrong email blocked; public promo; already-owned map; used/expired/invalid promo; transactional rollback |
| Paid promo | Server discount; database email; one checkout/order on repeated/concurrent requests; another user blocked; cancelled checkout resume; expired reservation; database-write retry; already-paid recovery |
| Promo maps | Generic selected map; invalid selection; bound map cannot be overridden; selection survives registration/login/cancellation |
| Promo return | Unpaid, refunded, wrong user/code/session rejected; real paid return; legacy URL; server verification failure cannot render success |
| Fulfilment | Browser before webhook; webhook before browser; repeated/out-of-order events; promo claimed by another account; receipt failure cannot roll back paid access |
| Other routes | Guest catalog checkout allowed; profile, saved routes, route planner and dashboard retain their existing guards |

The component tests execute the real component handlers/effects with mocked services and browser storage. Payment tests execute the real fulfilment functions with mocked Stripe/database transactions. They are not browser end-to-end or real database integration tests.

## Release verification still needed

Use an isolated staging database and Stripe test mode to check real card payment/cancel/refund, signed webhook delivery/retries, MongoDB transaction/index behavior, email delivery, Google callback, cross-origin refresh/logout cookies and actual browser navigation. Deploy backend before frontend. See `guest-map-checkout.md` for indexes and rollback behavior.
