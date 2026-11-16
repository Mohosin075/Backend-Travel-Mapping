# Automatic tax for website purchases

The website's map checkout, paid promo checkout and new hosted subscription checkout support Stripe Tax. The price shown by the website is the base price; Stripe collects the address and shows applicable tax and the final total before payment. Free promos do not enter payment checkout.

## Activation

1. Configure Stripe Tax in the client-owned Stripe account: business/head-office address, appropriate product tax classifications and active tax registrations. Collection depends on the customer's location and product rules, not a hardcoded country percentage. Zero tax can be the correct result.
2. For existing subscription products, verify their tax codes and Price tax behavior in Stripe. To add tax on top, use tax-exclusive Prices. New Prices created with the feature enabled explicitly use `exclusive`. Existing Prices and existing subscriptions are not rewritten.
3. Set `STRIPE_TAX_ENABLED=true` in the backend environment, run `npm run build`, then restart/redeploy the backend. Production starts `dist/server.js`, so a restart without rebuilding will continue using the old compiled code. The default is `false` so deploying code before completing Stripe configuration does not interrupt production checkout.
4. Optional `STRIPE_TAX_CODE` sets a classification for the inline map/promo products. If omitted, Stripe uses the account's preset tax code. Subscription products use their own Stripe product classification.

Only newly created Checkout Sessions use the new setting. Existing pending/idempotent checkout links keep their original Stripe quote. Review or expire old unpaid sessions as part of the rollout if all subsequent payments must use the new tax setting; paid sessions must not be recreated or charged again.

Saved guest payment records resume their stored Stripe session before making any creation request, preserving the original quote if the catalogue price or tax setting changes. If creation failed before a session/payment reference could be saved locally, reconcile that interrupted attempt in Stripe before switching tax settings; do not replace its idempotency key to force a new chargeable session.

No tax rate should be supplied by the browser. No Stripe account settings are changed by this patch. Stripe Tax charges may apply under the client's Stripe pricing.

## Payment records and reports

- Pending orders retain the server's base price until Stripe calculates the final charge.
- Successful Checkout verification/webhooks record the actual `amount_total`, `amount_subtotal`, `total_details.amount_tax`, discount and country. `Payment.amount` is the gross amount charged, in USD for map/promo purchases.
- PaymentIntent success records the actual charged amount. A later Checkout event reconciles the tax breakdown even if the order is already successful, without sending a second receipt or granting map access twice.
- Legacy guest completion checks the original subtotal plus Stripe's discount/tax breakdown and currency, so a valid taxed purchase can complete before or after the webhook without relaxing ownership/capability checks.
- Full refunds use the remaining Stripe charge amount, including tax, instead of guessing from a pre-tax price. Stripe's refund amount is saved.
- Dashboard/report tax totals sum saved actual `taxAmount`; the old fixed 10% estimate is removed. Historical records without a saved tax breakdown contribute zero recorded tax; this does not establish that their historical tax liability was zero. This patch does not backfill historical Stripe data.

## Boundaries

These settings apply to Stripe-hosted website Checkout Sessions. When the flag is enabled, the separate direct/mobile PaymentIntent and direct subscription-creation endpoints return a clear 400 asking the caller to use hosted Checkout; they cannot silently bypass tax calculation. Their existing behavior is preserved when the flag is disabled. Mobile/custom payment forms need a separate address/Tax API integration before re-enabling direct taxable payments. Existing subscription renewals are not enabled retroactively.

## Validation before enabling live collection

Use a Stripe sandbox with Tax configured. Check a taxable address, a valid zero-tax outcome, different states/postal codes, paid promo discounts, free promos, trial subscriptions, cancellation, full refunds and repeated/out-of-order webhooks. Confirm Stripe's final amounts match local payment and report totals. Keep existing checkout return URLs, authentication and map-access behavior.

References: https://docs.stripe.com/tax/checkout/page and https://docs.stripe.com/tax/set-up
