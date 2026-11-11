# New-user map purchase flow: rollback review and implementation

Reviewed on 11 November 2026 (Asia/Dhaka).

## Recommendation

Restore the old login/register-first purchase entry point with a targeted change on top of the latest remote code. Keep payment fulfilment, existing guest-account recovery and the security fixes introduced alongside guest checkout. Do not reset either repository to an earlier commit or revert the entire mixed feature commits.

The investigation below records the original assessment. The authorized local implementation is recorded in the final section. Production, database records and Stripe sessions have not been changed.

## Repositories and history

- Frontend: `D:\Mohosin\projects\dashboard\giovafilm_mapping`. Local `main` is `7709112` (5 November); the primary GitHub remote `main` is `3678198` (10 November).
- Backend: `D:\Mohosin\projects\giovafilm-roadtripeado`. Local `main` is `8f96c95` (5 November); the primary GitHub remote `main` is `8935120` (10 November).
- The additional `Frontend-Travel-Mapping` and `-Travel-Mapping` push remotes still point to the respective 5 November commits. Both repositories have multiple configured push destinations. Review the destination explicitly before a later push.
- Remote heads were verified using `git ls-remote`, then the exact commits were fetched without switching branches or updating working files. The deployed production revisions have not been verified.

Relevant frontend commits:

- `e24c623` — 9 November, 23:19 +0600: guest purchase entry, checkout page, password setup, auth and promo changes. This is the main behavior change.
- `bbf11f2` — 10 November, 00:06 +0600: guest checkout UI and retry/error handling.
- `3678198` — 10 November, 01:54 +0600: reminder styling for unverified purchase accounts.
- Reference immediately before the main change: `4ab1d23`. Use this as a comparison reference, not a whole-repository rollback target.

Relevant backend commits:

- `7e0bba6` — 9 November, 23:19 +0600: guest checkout plus auth, payment, webhook and promo fixes.
- `429c0c7` — 10 November, 00:32 +0600: validated frontend return origins for guest and promo payments.
- `7b4e8a0` — 10 November, 00:43 +0600: further promo changes.
- `8935120` — 10 November, 01:08 +0600: auth/UI flow tests.
- Reference immediately before the main change: `ef646f6`. Use this as a comparison reference only.

## Confirmed old and new behavior

Old behavior:

1. A visitor opens a map detail page and selects Buy Now.
2. Without an access token, `handleBuyNow` opens the existing login-required modal, preserving the detail-page URL.
3. The visitor logs in, registers and verifies their account, or uses Google. They return to the map detail page.
4. Buy Now creates an authenticated `/payment/create-checkout-session` request. The historical flow requires selecting Buy Now again after returning; it does not automatically start Stripe.
5. Stripe returns to `/?session_id=...&success=true`; the home page verifies payment and navigates to `/profile/purchased-maps`.

New behavior:

1. Guest Buy Now navigates to `/catalog/checkout?mapId=...`.
2. The visitor submits an email. `POST /payment/guest/start` creates an active, unverified, passwordless account with `provider=guest_purchase` BEFORE creating a Stripe session. Cancellation can therefore leave an account without a purchase.
3. A random checkout capability is saved in browser `sessionStorage`; the backend stores its hash with an expiry of 24 hours.
4. After payment, Stripe returns to `/catalog/checkout?...&session_id=...`. `/payment/guest/complete` checks the capability and payment, fulfils access, and issues login tokens. The map opens immediately; email verification/password setup remains a separate recovery step.
5. Existing email addresses go through login/recovery. Successful authentication returns to checkout using `resume=1`.

The authenticated checkout endpoint and the historical home-page verification path still exist. Rebuilding those paths is unnecessary.

## Proposed targeted implementation

### 1. Restore the main frontend entry

In `components/Common/maps/feature-map-detail.tsx`, restore the unauthenticated branch of `handleBuyNow`:

```tsx
if (!accessToken) {
  openLoginRequired(window.location.pathname + window.location.search);
  return;
}
```

At remote `3678198`, the changed redirect is at line 114. The rest of the existing authenticated checkout, reward redemption, pricing and payment return logic can stay intact.

### 2. Handle direct checkout URLs and historical returns

A one-line Buy Now change restores the normal entry point, but `/catalog/checkout` remains public through the existing `/catalog/*` route allowance. A visitor or an older frontend can still start guest checkout unless it is explicitly gated.

Update `components/Common/maps/map-checkout.tsx` to send fresh unauthenticated visits to the login/register-first flow, preserving the selected map. Preserve handling for existing saved attempts, Stripe `session_id` returns, cancellation/retry and recovery links. Do not gate every unauthenticated render before processing an existing payment return.

Keep `app/(common)/catalog/checkout/page.tsx` available for compatibility. The authenticated `resume=1` path may continue for existing recovery links; ordinary new purchases should use the old detail-page flow.

### 3. Stop new guest account creation on the backend

For a complete feature rollback, gate only NEW attempt creation in `src/modules/payment/guest-checkout.controller.ts`. In `start`, distinguish an existing valid attempt from the `else` branch that calls `User.create`. A closed feature gate should return sign-in-required guidance for a new attempt, without creating an account or a Stripe session.

Continue validating and serving valid existing attempts. Keep `/payment/guest/complete`, the guest attempt model, payment metadata/indexes, fulfilment and receipt/recovery behavior available for previously started or paid orders.

Keep the authenticated `/payment/create-checkout-session` route protected by its existing auth middleware. No price/currency or payment validation rollback is needed.

### 4. Preserve recovery and independent fixes

Retain these parts even after new guest checkout is disabled:

- `/set-password`, OTP/reset handling, the passwordless-account login guidance and `PurchaseAccountReminder`. Existing guest buyers may need these to recover their maps.
- Guest records, payment records, purchased maps, `guestCheckoutKey`/`promoCheckoutKey` and their indexes. No data deletion or database rollback is indicated.
- Single-use OTP/reset-token checks, active-account/current-role refresh, consistent cookies, safe redirects and clearing cached account data at login.
- Server-side prices and USD currency behavior, duplicate-ownership checks, Stripe idempotency, signed webhooks and refund/terminal-state protection.
- Promo payment verification, recipient ownership checks, reservations, transactional free claims and validated return origins. Promo visitors already use login/register; this is a separate flow.
- Recent map, offer, reporting and performance work.

The guest API hooks in `redux/features/payment/paymentApi.ts` must remain while historical return/retry handling uses them. Removing them or the backend routes immediately would break that handling.

## Release sequence and checks

1. Prepare the patch against the inspected latest remote revisions, preserving the existing local checkout. Do not implement against the stale local 5 November source and assume it represents the current feature.
2. Verify new visitor Buy Now -> modal -> register/login/Google -> same map detail -> authenticated Stripe checkout -> verified purchased map.
3. Verify direct checkout URLs do not create new guest accounts; duplicate ownership, free-map rewards, cancellation and authenticated retries still behave correctly.
4. Verify existing guest Stripe returns, same-tab retries, lost/expired browser capability recovery and password setup still grant access to the original account without another charge.
5. Verify free/paid promos, wrong account/code/session, refunds, delayed/duplicate webhooks and account switching.
6. Deploy the frontend behavior change first. Then deploy the backend new-attempt gate while retaining completion and fulfilment. Both repos contain main-branch deployment workflows, so a push can be operationally significant; none was performed in this review.
7. Retain compatibility through at least the latest valid attempt expiry, and inspect outstanding Stripe sessions/payments and delayed events before any later cleanup. The 24-hour capability expiry is not evidence that every order is settled. Passwordless-account recovery must remain as long as such accounts exist.

## Initial review verification

Executed these existing test suites against isolated copies of frontend `3678198` and backend `8935120`, using the installed dependency directories:

```text
node --test --test-reporter=dot tests/guest-map-checkout.test.cjs tests/map-payment-currency.test.cjs tests/auth-promo-regressions.test.cjs tests/auth-ui-flow.test.cjs
```

Result: 201 tests passed; exit code 0. These tests use mocked Stripe, email, database and browser services. They validate the current feature and the behavior that rollback must preserve; they do not validate an implemented rollback patch.

No production database/Stripe queries, live payments, customer email, deployments, TypeScript build or real browser end-to-end checks were performed. Whether guest accounts or in-flight sessions currently exist in production is unknown and should be checked before retiring compatibility code.

## Authorized local implementation

The changes were prepared on `fix/login-first-map-purchase` branches based on the exact latest remote revisions listed above. No existing history was rewritten. The user subsequently authorized fast-forwarding and pushing these changes to the primary repositories' `main` branches.

Implemented:

- Frontend `components/Common/maps/feature-map-detail.tsx`: restored the original login-required modal and map-detail return path for guest Buy Now.
- Frontend `components/Common/maps/map-checkout.tsx`: new guests return to the same map's login/register flow; no new checkout capability or editable email entry is offered. Saved historical capabilities still support retries, authenticated resumption and payment returns, including lost-storage recovery guidance.
- Backend `src/modules/payment/guest-checkout.controller.ts`: removed new guest user/attempt creation. Unknown capabilities receive sign-in-required guidance; valid existing attempts can still resume, finish interrupted session creation and complete paid orders.
- Existing auth, promo, pricing, currency, receipt, webhook, index and account-recovery code was retained.
- Updated the purchase tests for the restored behavior, including direct URLs, invalid browser storage, lost capabilities, registration/login map returns, existing attempts, payment completion, authenticated checkout and free-map rewards. Cross-repository test resolution supports the actual local frontend folder and an explicit `GIOVAFILM_FRONTEND_DIR` override.

Final validation:

- Purchase/auth/promo/UI regression suites: **233 passed, 0 failed** against the modified local sources, including the purchase double-check and promo-login follow-up.
- Backend TypeScript check: passed.
- Frontend TypeScript check: passed.
- Frontend `npm run build`: passed; all 57 pages generated. The existing Next.js middleware-to-proxy deprecation warning remains unrelated to this change.
- Backend `npm.cmd run build -- --outDir <temporary-directory>`: passed. Existing compiled files in the repository were not overwritten.
- `git diff --check`: passed in both repositories.

The automated tests mock external services; no live payment, real email, database migration or browser end-to-end payment was performed. Validation was completed locally before the user authorized committing and pushing the changes. Deployment status is reported separately from these local validation results.

Follow-up double-check found and fixed two recovery gaps: malformed browser storage during an in-progress retry did not return to login, and failed payment returns lacked actionable recovery links. Capability parsing now handles missing/null/malformed values consistently. Payment-return recovery goes to purchased maps; unfinished-attempt login returns to map details. These recovery paths no longer request automatic checkout resumption, avoiding a new payment attempt before a delayed fulfilment is visible. Added regression cases also verify that another signed-in account cannot be replaced by a guest payment return.

The subsequent promo-login review also updated frontend `app/(common)/claim-promo/page.tsx`: paid-return login retains the selected map; free/paid confirmation and asynchronous updates are scoped to the current account/invitation; delayed redirects stop after logout; and already-redeemed invitations send returning buyers to Purchased Maps. The backend promo claim, recipient verification, payment verification and reservation protections were retained. See `docs/auth-purchase-promo-audit.md` for the tested scenarios and external-service verification limits.
