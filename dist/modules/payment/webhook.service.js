"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookService = void 0;
const http_status_codes_1 = require("http-status-codes");
const config_1 = __importDefault(require("../../config"));
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const payment_model_1 = require("./payment.model");
const emailHelper_1 = require("../../helpers/emailHelper");
const user_model_1 = require("../user/user.model");
const stripe_1 = __importDefault(require("../../config/stripe"));
const promo_model_1 = require("../promo/promo.model");
const stripePaymentTotals_1 = require("../../helpers/stripePaymentTotals");
const handleCheckoutSessionCompleted = async (sessionData) => {
    var _a, _b, _c, _d;
    try {
        console.log('🔔 Processing Checkout Session Completed:', sessionData.id);
        const sessionWithDetails = await stripe_1.default.checkout.sessions.retrieve(sessionData.id, {
            expand: ['payment_intent', 'line_items'],
        });
        if (sessionWithDetails.payment_status !== 'paid')
            return;
        console.log('✅ Session Details Retrieved. Payment Intent:', sessionWithDetails.payment_intent);
        let lookupId;
        if (typeof sessionWithDetails.payment_intent === 'string') {
            lookupId = sessionWithDetails.payment_intent;
        }
        else if ((_a = sessionWithDetails.payment_intent) === null || _a === void 0 ? void 0 : _a.id) {
            lookupId = sessionWithDetails.payment_intent.id;
        }
        else {
            lookupId = sessionWithDetails.id;
        }
        const mongoSession = await payment_model_1.Payment.startSession();
        mongoSession.startTransaction();
        try {
            // Find and lock the payment document
            const payment = await payment_model_1.Payment.findOne({
                $or: [
                    { paymentIntentId: lookupId },
                    { paymentIntentId: sessionWithDetails.id },
                    { 'metadata.checkoutSessionId': sessionWithDetails.id },
                ],
            }).session(mongoSession);
            if (!payment) {
                throw new Error(`Payment not found for session: ${sessionWithDetails.id}`);
            }
            // Check if already processed to avoid duplicates
            if (payment.status === 'refunded') {
                await mongoSession.commitTransaction();
                return;
            }
            if (payment.status === 'succeeded') {
                const changed = (0, stripePaymentTotals_1.applyStripeCheckoutTotals)(payment, sessionWithDetails);
                const intentChanged = payment.paymentIntentId !== lookupId;
                payment.paymentIntentId = lookupId;
                if (changed || intentChanged)
                    await payment.save({ session: mongoSession });
                await mongoSession.commitTransaction();
                return;
            }
            // Update payment
            (0, stripePaymentTotals_1.applyStripeCheckoutTotals)(payment, sessionWithDetails);
            payment.status = 'succeeded';
            payment.paymentIntentId = lookupId;
            payment.metadata = { ...payment.metadata, paymentIntentId: lookupId };
            payment.metadata = { ...payment.metadata, ...sessionWithDetails };
            await payment.save({ session: mongoSession });
            // Update User purchasedMaps if mapId exists in metadata or payment
            const mapId = payment.mapId || ((_b = sessionWithDetails.metadata) === null || _b === void 0 ? void 0 : _b.mapId);
            console.log(`Webhook: Processing map purchase update for Map ID: ${mapId}`);
            if (mapId) {
                const updatedUser = await user_model_1.User.findByIdAndUpdate(payment.userId, {
                    $addToSet: { purchasedMaps: mapId },
                }, { session: mongoSession, new: true });
                if (updatedUser) {
                    console.log(`Webhook: User purchasedMaps updated for User ID: ${payment.userId}`);
                }
            }
            // Handle Promo Link usage if applicable
            const promoCode = ((_c = sessionWithDetails.metadata) === null || _c === void 0 ? void 0 : _c.promoCode) || ((_d = payment.metadata) === null || _d === void 0 ? void 0 : _d.promoCode);
            if (promoCode) {
                console.log(`Webhook: Processing promo code usage for code: ${promoCode}`);
                const updatedPromo = await promo_model_1.PromoLink.findOneAndUpdate({ code: promoCode, $or: [{ isUsed: false }, { usedBy: payment.userId }] }, {
                    isUsed: true,
                    usedBy: payment.userId,
                    usedAt: new Date(),
                }, { session: mongoSession, new: true });
                if (updatedPromo) {
                    console.log(`Webhook: PromoLink code: ${promoCode} marked as used`);
                }
                else {
                    throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'Promo already claimed by another account; payment retained for support.');
                }
            }
            await mongoSession.commitTransaction();
            console.log(`Successfully processed payment for session: ${sessionWithDetails.id}`);
            // Send email
            await emailHelper_1.emailHelper.sendEmail({
                to: payment.userEmail,
                subject: 'Payment Successful',
                html: payment.guestCheckoutKey
                    ? `<p>Your map purchase is ready.</p><p><a href="${config_1.default.clientUrl}/set-password?email=${encodeURIComponent(payment.userEmail)}">Verify your email and set a password</a> to return to your account later.</p>`
                    : `<p>Your payment was successful.</p>`,
            }).catch(error => console.error('Payment receipt email failed:', error));
        }
        catch (error) {
            await mongoSession.abortTransaction();
            throw error;
        }
        finally {
            mongoSession.endSession();
        }
    }
    catch (error) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Checkout processing failed: ${error.message}`);
    }
};
const handleCheckoutSessionExpired = async (session) => {
    const mongoSession = await payment_model_1.Payment.startSession();
    mongoSession.startTransaction();
    try {
        const payment = await payment_model_1.Payment.findOne({
            $or: [
                { paymentIntentId: session.id },
                { 'metadata.checkoutSessionId': session.id },
            ],
        }).session(mongoSession);
        if (payment && payment.status !== 'succeeded' && payment.status !== 'refunded') {
            payment.status = 'failed';
            payment.metadata = { ...payment.metadata, ...session, expired: true };
            await payment.save({ session: mongoSession });
        }
        await mongoSession.commitTransaction();
    }
    catch (error) {
        await mongoSession.abortTransaction();
        throw error;
    }
    finally {
        mongoSession.endSession();
    }
};
const handlePaymentSuccess = async (paymentIntent) => {
    var _a;
    const mongoSession = await payment_model_1.Payment.startSession();
    mongoSession.startTransaction();
    try {
        // STRICT LOOKUP: First try paymentIntentId
        let payment = await payment_model_1.Payment.findOne({
            paymentIntentId: paymentIntent.id,
        }).session(mongoSession);
        // FALLBACK LOOKUP: Use mapId and userId from metadata
        if (!payment) {
            const metadata = paymentIntent.metadata || {};
            const mapId = metadata.mapId;
            const userId = metadata.userId;
            if (mapId && userId) {
                payment = await payment_model_1.Payment.findOne({
                    mapId,
                    userId,
                    status: 'pending',
                })
                    .sort({ createdAt: -1 })
                    .session(mongoSession);
                if (payment) {
                    payment.paymentIntentId = paymentIntent.id;
                }
            }
        }
        if (!payment) {
            await mongoSession.commitTransaction();
            return;
        }
        // Check if already processed
        if (payment.status === 'succeeded' || payment.status === 'refunded') {
            await mongoSession.commitTransaction();
            return;
        }
        // Update payment
        (0, stripePaymentTotals_1.applyStripeIntentTotal)(payment, paymentIntent);
        payment.status = 'succeeded';
        // Ensure we don't overwrite crucial metadata if it exists
        payment.metadata = { ...payment.metadata, ...paymentIntent };
        await payment.save({ session: mongoSession });
        // Update User purchasedMaps if mapId exists
        const mapId = payment.mapId || ((_a = paymentIntent.metadata) === null || _a === void 0 ? void 0 : _a.mapId);
        if (mapId) {
            const updatedUser = await user_model_1.User.findByIdAndUpdate(payment.userId, {
                $addToSet: { purchasedMaps: mapId },
            }, { session: mongoSession, new: true });
            if (updatedUser) {
                console.log(`Webhook: User purchasedMaps updated for User ID: ${payment.userId}`);
            }
        }
        await mongoSession.commitTransaction();
        console.log(`Successfully processed payment intent: ${paymentIntent.id}`);
        // Send email
        if (payment.userEmail) {
            await emailHelper_1.emailHelper.sendEmail({
                to: payment.userEmail,
                subject: 'Payment Successful',
                html: `<p>Your payment was successful.</p>`,
            });
        }
    }
    catch (error) {
        await mongoSession.abortTransaction();
        throw error;
    }
    finally {
        mongoSession.endSession();
    }
};
const handlePaymentFailure = async (paymentIntent) => {
    var _a, _b;
    const mongoSession = await payment_model_1.Payment.startSession();
    mongoSession.startTransaction();
    try {
        let payment = await payment_model_1.Payment.findOne({
            paymentIntentId: paymentIntent.id,
        }).session(mongoSession);
        // Fallback for failure too
        if (!payment && ((_a = paymentIntent.metadata) === null || _a === void 0 ? void 0 : _a.mapId) && ((_b = paymentIntent.metadata) === null || _b === void 0 ? void 0 : _b.userId)) {
            payment = await payment_model_1.Payment.findOne({
                mapId: paymentIntent.metadata.mapId,
                userId: paymentIntent.metadata.userId,
                status: 'pending',
            }).session(mongoSession);
        }
        if (payment && payment.status !== 'succeeded' && payment.status !== 'refunded') {
            payment.status = 'failed';
            payment.metadata = { ...payment.metadata, ...paymentIntent };
            await payment.save({ session: mongoSession });
        }
        await mongoSession.commitTransaction();
    }
    catch (error) {
        await mongoSession.abortTransaction();
        throw error;
    }
    finally {
        mongoSession.endSession();
    }
};
const handleChargeRefunded = async (charge) => {
    var _a, _b, _c, _d;
    try {
        const paymentIntentId = typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : (_a = charge.payment_intent) === null || _a === void 0 ? void 0 : _a.id;
        if (!paymentIntentId)
            return;
        const payment = await payment_model_1.Payment.findOne({
            $or: [
                { paymentIntentId },
                { 'metadata.paymentIntentId': paymentIntentId },
                { 'metadata.payment_intent': paymentIntentId },
                { 'metadata.payment_intent.id': paymentIntentId },
            ],
        });
        if (payment) {
            (0, stripePaymentTotals_1.applyStripeIntentTotal)(payment, { amount: charge.amount, currency: charge.currency });
            payment.status = 'refunded';
            payment.refundAmount = charge.amount_refunded
                ? charge.amount_refunded / 100
                : payment.amount;
            payment.refundReason =
                ((_d = (_c = (_b = charge.refunds) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.reason) || 'refunded_via_stripe';
            await payment.save();
            if (payment.userId && payment.mapId) {
                await user_model_1.User.findByIdAndUpdate(payment.userId, {
                    $pull: { purchasedMaps: payment.mapId },
                    $addToSet: { deactivatedMaps: payment.mapId },
                });
            }
        }
    }
    catch (error) {
        console.error('Error handling charge.refunded webhook:', error);
        throw error;
    }
};
exports.WebhookService = {
    handleWebhook: async (payload) => {
        try {
            const signature = payload.headers['stripe-signature'];
            const webhookSecret = config_1.default.stripe.paymentWebhookSecret;
            let event;
            if (signature && webhookSecret) {
                try {
                    event = stripe_1.default.webhooks.constructEvent(payload.body, signature, webhookSecret);
                }
                catch (err) {
                    console.error('⚠️ Webhook signature verification failed:', err.message);
                    throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid webhook signature');
                }
            }
            else {
                if (config_1.default.node_env === 'production' || webhookSecret) {
                    throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Webhook signature and secret are required');
                }
                event = JSON.parse(payload.body.toString());
            }
            console.log(`Processing webhook: ${event.type}`);
            switch (event.type) {
                case 'checkout.session.completed':
                    await handleCheckoutSessionCompleted(event.data.object);
                    break;
                case 'checkout.session.expired':
                    await handleCheckoutSessionExpired(event.data.object);
                    break;
                case 'payment_intent.succeeded':
                    await handlePaymentSuccess(event.data.object);
                    break;
                case 'payment_intent.payment_failed':
                    await handlePaymentFailure(event.data.object);
                    break;
                case 'charge.refunded':
                    await handleChargeRefunded(event.data.object);
                    break;
                default:
                    console.log(`Unhandled event type: ${event.type}`);
            }
        }
        catch (error) {
            console.error('Webhook processing error:', error);
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Webhook processing failed: ${error.message}`);
        }
    },
};
