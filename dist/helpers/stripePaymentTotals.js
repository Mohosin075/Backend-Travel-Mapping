"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyStripeIntentTotal = exports.applyStripeCheckoutTotals = exports.checkoutMatchesPaymentTotal = void 0;
const isAmount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
// A guest capability still has to match the original order quote before fulfilment.
const checkoutMatchesPaymentTotal = (payment, session) => {
    var _a, _b, _c, _d, _e;
    if (!isAmount(session.amount_total) || !session.currency ||
        session.currency.toUpperCase() !== payment.currency.toUpperCase())
        return false;
    if (!((_a = session.automatic_tax) === null || _a === void 0 ? void 0 : _a.enabled))
        return session.amount_total === Math.round(payment.amount * 100);
    const tax = (_b = session.total_details) === null || _b === void 0 ? void 0 : _b.amount_tax;
    const discount = (_d = (_c = session.total_details) === null || _c === void 0 ? void 0 : _c.amount_discount) !== null && _d !== void 0 ? _d : 0;
    if (session.automatic_tax.status !== 'complete' || !isAmount(session.amount_subtotal) ||
        !isAmount(tax) || !isAmount(discount))
        return false;
    const originalSubtotal = (_e = payment.subtotalAmount) !== null && _e !== void 0 ? _e : payment.amount - (payment.taxAmount || 0) + (payment.discountAmount || 0);
    return session.amount_subtotal === Math.round(originalSubtotal * 100) &&
        session.amount_total === session.amount_subtotal - discount + tax;
};
exports.checkoutMatchesPaymentTotal = checkoutMatchesPaymentTotal;
// Amounts come only from authenticated Stripe responses/webhooks, never the browser.
const applyStripeCheckoutTotals = (payment, session) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (((_a = session.automatic_tax) === null || _a === void 0 ? void 0 : _a.enabled) && session.automatic_tax.status !== 'complete') {
        throw new Error('Stripe has not completed the tax calculation for this payment.');
    }
    if (!isAmount(session.amount_total)) {
        if ((_b = session.automatic_tax) === null || _b === void 0 ? void 0 : _b.enabled)
            throw new Error('Stripe payment total is missing.');
        return false; // Retain compatibility with legacy sessions without a tax breakdown.
    }
    if (session.currency && session.currency.toUpperCase() !== payment.currency.toUpperCase()) {
        throw new Error('Stripe payment currency does not match the order.');
    }
    const tax = (_d = (_c = session.total_details) === null || _c === void 0 ? void 0 : _c.amount_tax) !== null && _d !== void 0 ? _d : 0;
    const discount = (_f = (_e = session.total_details) === null || _e === void 0 ? void 0 : _e.amount_discount) !== null && _f !== void 0 ? _f : 0;
    if (!isAmount(tax) || !isAmount(discount))
        throw new Error('Invalid Stripe tax breakdown.');
    const subtotal = (_g = session.amount_subtotal) !== null && _g !== void 0 ? _g : session.amount_total - tax + discount;
    if (!isAmount(subtotal))
        throw new Error('Invalid Stripe payment subtotal.');
    const values = {
        amount: session.amount_total / 100,
        subtotalAmount: subtotal / 100,
        taxAmount: tax / 100,
        discountAmount: discount / 100,
        ...(((_j = (_h = session.customer_details) === null || _h === void 0 ? void 0 : _h.address) === null || _j === void 0 ? void 0 : _j.country) ? { taxCountry: session.customer_details.address.country } : {}),
    };
    const changed = Object.entries(values).some(([key, value]) => payment[key] !== value);
    Object.assign(payment, values);
    return changed;
};
exports.applyStripeCheckoutTotals = applyStripeCheckoutTotals;
const applyStripeIntentTotal = (payment, intent) => {
    var _a;
    const amount = (_a = intent.amount_received) !== null && _a !== void 0 ? _a : intent.amount;
    if (!isAmount(amount))
        return;
    if (intent.currency && intent.currency.toUpperCase() !== payment.currency.toUpperCase()) {
        throw new Error('Stripe payment currency does not match the order.');
    }
    // Preserve the original quote if this event arrives before the Checkout tax breakdown.
    if (payment.subtotalAmount == null) {
        payment.subtotalAmount = payment.amount - (payment.taxAmount || 0) + (payment.discountAmount || 0);
    }
    payment.amount = amount / 100;
};
exports.applyStripeIntentTotal = applyStripeIntentTotal;
