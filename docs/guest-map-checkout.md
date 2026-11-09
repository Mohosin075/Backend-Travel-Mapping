# Guest map checkout

Local implementation only. No production database or Stripe account was used for verification.

## Behavior

- Guest Buy Now opens `/catalog/checkout?mapId=...` and asks for email.
- A new email creates an active, unverified `user` with `provider=guest_purchase`, without a password, **before** Stripe checkout is created. No login token is issued at this stage.
- A failed/cancelled checkout keeps that account, without purchased-map access. The same browser tab can resume its saved checkout. Another browser, lost browser storage, or an expired checkout must use email verification/password setup or Google sign-in.
- Existing emails, including abandoned guest accounts, must sign in. Existing passwords/roles are preserved. Normal login, Google and password recovery carry the selected map back to checkout.
- Payment completion requires a 256-bit checkout capability saved in sessionStorage, a matching server hash, matching Stripe session/user/map/amount/currency, paid status and an unrefunded payment. The capability expires after 24 hours and is consumed atomically once.
- A successful payment attaches the map through the existing fulfilment path, issues the normal access/refresh tokens and opens the map. Payment does not mark the email verified. The account reminder and receipt direct the buyer to email OTP and password setup.
- Password setup or Google verification before payment completion requires normal sign-in after fulfilment; the purchase is retained.
- Repeated requests reuse the same Stripe idempotency key and payment upsert. Browser verification can fulfil before webhook delivery. Invalid webhook signatures are rejected; terminal payment states survive repeated/out-of-order failure events.
- Ordinary protected-route middleware is unchanged. After successful guest login, normal user permissions apply to other features.
- First password setup uses the public `/set-password` page: verify email, enter the code, then set a password. Setup links, page copy and passwordless-account emails use verification/setup wording. The ordinary `/forgot-password` flow retains password-recovery wording. Both continue to use the same server OTP/reset-token checks.
- Returning passwordless purchase accounts receive explicit setup guidance on login, without an automatic OTP redirect, email or login token. The login page also provides a setup link that requires no guessed password. Accounts with a saved password must match it before either login or a signup-verification redirect. Setup retains the same account and purchased maps.
- Guest Stripe success/cancel URLs use the browser's validated frontend Origin, rather than always using `clientUrl`. New attempts retain that origin and cannot be resumed/redeemed from another origin. Requests without an Origin fall back to `clientUrl`; unapproved production origins are rejected before account creation.
- Paid promo checkout uses the same origin validation. Success/cancel URLs retain the selected map, and an active promo reservation cannot be redirected to another frontend origin. Promo visitors continue to use the existing login/register flow; free promos grant access without Stripe.

## Localhost returns

Keep the exact frontend origin (for example `http://localhost:3000`) in the backend CORS configuration. Development loopback origins are recognized by the checkout controller, but the request must also pass the application's CORS policy. Production permits localhost only when it is explicitly configured as an allowed origin. An arbitrary URL in the request body cannot choose the return destination.

Restart the backend after applying this change. Existing Stripe sessions retain the return URL with which they were created. If a legacy session was already paid and returned to the production domain, open the same `/catalog/checkout?mapId=...&session_id=...` path on the original localhost origin in the original browser tab. This preserves access to the locally saved capability and avoids another payment. If storage was lost or the capability expired, recover through email verification/login instead.

## Rollout

1. Deploy backend first, then frontend. The existing authenticated checkout endpoint remains available.
2. Ensure `clientUrl` is the canonical frontend origin, `NODE_ENV=production`, `PAYMENT_WEBHOOK_SECRET` matches the Stripe **payment** webhook, and current JWT, email, CORS and refresh-cookie configuration is intact. Unsigned or misconfigured production webhooks now fail closed.
3. Verify the additive indexes exist: `guestcheckouts.tokenHash` unique, `payments.guestCheckoutKey` unique/sparse, and `payments.promoCheckoutKey` unique/sparse. Existing payments have no checkout keys. Normal Mongoose auto-indexing creates these; when auto-indexing is disabled, create them explicitly before enabling purchases. Do not run `syncIndexes` or remove existing indexes. Checkout start waits for model initialization. Free promo consumption/access now commit in one MongoDB transaction, using the same replica-set requirement as existing payment fulfilment.
4. Use an isolated staging database and Stripe test keys to verify an actual payment, cancellation/retry, existing password/Google login, email OTP/password setup, refund, delayed/duplicate webhook and refresh-cookie behavior. No live charge is needed for this check.
5. Roll back frontend first if needed. Keep paid orders, guest accounts and map entitlements; do not delete them during rollback. Guests can recover using the existing forgot-password flow.

## Recovery

An interrupted account/attempt creation may leave a passwordless account without a checkout. Email verification/password setup recovers it; it must never be automatically reclaimed based on email alone. A lost completion response after the one-time capability was consumed also uses normal login or email recovery. Expired attempt records are retained for support/audit, without granting authentication. Abandoned-account cleanup is intentionally not automatic.

## Local checks

Run `node --test tests/guest-map-checkout.test.cjs tests/map-payment-currency.test.cjs tests/auth-promo-regressions.test.cjs tests/auth-ui-flow.test.cjs` and TypeScript checks in each repository. Run the frontend production build. The full pre-existing suite has baseline failures, including old frontend paths and outdated tracking/geocoder mocks; compare against committed sources before attributing failures to this change.

Verified locally for this change:

- Purchase/auth/promo/security/currency and component-flow tests: 177 passed, 0 failed, including free/paid promo returns, returning passwordless buyers, wrong passwords, first-password setup versus real forgotten-password flow, localhost/production return origins, rejected redirect origins, existing-email button navigation, timeout feedback and invalid email feedback. See `auth-purchase-promo-audit.md` for coverage.
- Backend TypeScript check and frontend production build: passed.
- Full non-integration suite retains the same 19 pre-existing failing test names. Running the old suite against committed versions of every changed file reproduced those failures (111 passed / 19 failed before this change).
- Live Stripe, actual email delivery, database transactions/index creation and browser end-to-end behavior remain staging checks; local tests mock those external services.
