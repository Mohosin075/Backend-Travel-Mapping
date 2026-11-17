"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentServices = void 0;
const user_1 = require("../../enum/user");
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const payment_model_1 = require("./payment.model");
const paginationHelper_1 = require("../../helpers/paginationHelper");
const payment_constants_1 = require("./payment.constants");
const mongoose_1 = require("mongoose");
const user_model_1 = require("../user/user.model");
const map_model_1 = require("../map/map.model");
const config_1 = __importDefault(require("../../config"));
const promo_model_1 = require("../promo/promo.model");
const webhook_service_1 = require("./webhook.service");
const emailHelper_1 = require("../../helpers/emailHelper");
const stripe_1 = __importDefault(require("../../config/stripe"));
const invoiceHelper_1 = require("../../helpers/invoiceHelper");
const localize_1 = require("../../helpers/localize");
const stripePaymentTotals_1 = require("../../helpers/stripePaymentTotals");
// Catalog map prices are USD. Clients must not reinterpret the stored price
// as another currency when creating either web or mobile payments.
const MAP_PAYMENT_CURRENCY = 'usd';
const createCheckoutSession = async (user, payload, idempotencyKey) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const map = await map_model_1.Map.findById(payload.mapId);
        if (!map) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
        }
        if (!map.isPaid) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This map is free and does not require checkout');
        }
        if (!map.price || map.price <= 0) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Map price is not configured');
        }
        // Always charge server-side map price (ignore client amount)
        const amount = map.price;
        const currency = MAP_PAYMENT_CURRENCY;
        if (!idempotencyKey) {
            const buyer = await user_model_1.User.findById(user.authId);
            if ((_a = buyer === null || buyer === void 0 ? void 0 : buyer.purchasedMaps) === null || _a === void 0 ? void 0 : _a.some(id => String(id) === String(map._id))) {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'You already own this map.');
            }
        }
        const previousPayment = idempotencyKey ? await payment_model_1.Payment.findOne({ guestCheckoutKey: idempotencyKey }) : null;
        if (previousPayment && (String(previousPayment.userId) !== String(user.authId) ||
            String(previousPayment.mapId) !== String(payload.mapId))) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'This checkout belongs to a different purchase.');
        }
        const successUrl = payload.successUrl || `${config_1.default.clientUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`;
        // Resuming a saved checkout must not recreate it with today's price/tax settings.
        const session = ((_b = previousPayment === null || previousPayment === void 0 ? void 0 : previousPayment.metadata) === null || _b === void 0 ? void 0 : _b.checkoutSessionId)
            ? await stripe_1.default.checkout.sessions.retrieve(previousPayment.metadata.checkoutSessionId)
            : await stripe_1.default.checkout.sessions.create({
                ...(((_c = config_1.default.stripe) === null || _c === void 0 ? void 0 : _c.automaticTaxEnabled) ? {
                    automatic_tax: { enabled: true },
                    billing_address_collection: 'required',
                } : {}),
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            ...(((_d = config_1.default.stripe) === null || _d === void 0 ? void 0 : _d.automaticTaxEnabled) ? { tax_behavior: 'exclusive' } : {}),
                            currency,
                            product_data: {
                                ...(((_e = config_1.default.stripe) === null || _e === void 0 ? void 0 : _e.automaticTaxEnabled) && config_1.default.stripe.taxCode ? { tax_code: config_1.default.stripe.taxCode } : {}),
                                name: payload.productName || (0, localize_1.localizeField)(map.name) || 'Map Purchase',
                                description: payload.description || (0, localize_1.localizeField)(map.description) || undefined,
                            },
                            unit_amount: Math.round(amount * 100),
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                success_url: successUrl,
                cancel_url: payload.cancelUrl ||
                    `${config_1.default.clientUrl}/payment-failed?success=false`,
                customer_email: user.email,
                metadata: {
                    ...payload.metadata,
                    userId: user.authId.toString(),
                    mapId: payload.mapId.toString(),
                },
            }, idempotencyKey ? { idempotencyKey } : undefined);
        if (idempotencyKey) {
            if (session.status === 'expired') {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Checkout expired. Verify your email and sign in to try again.');
            }
            // Retry after Stripe success / DB failure must reuse the same payment.
            await payment_model_1.Payment.updateOne({ guestCheckoutKey: idempotencyKey }, { $setOnInsert: {
                    guestCheckoutKey: idempotencyKey,
                    userId: user.authId, mapId: payload.mapId, userEmail: user.email,
                    amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : amount,
                    currency: (session.currency || currency).toUpperCase(), paymentMethod: 'stripe',
                    ...(((_f = session.automatic_tax) === null || _f === void 0 ? void 0 : _f.enabled) ? { subtotalAmount: ((_g = session.amount_subtotal) !== null && _g !== void 0 ? _g : Math.round(amount * 100)) / 100 } : {}),
                    paymentIntentId: session.id, status: 'pending',
                    metadata: { checkoutSessionId: session.id, mapId: payload.mapId.toString() },
                } }, { upsert: true }).catch(async (error) => {
                if (error.code !== 11000 || !await payment_model_1.Payment.findOne({ guestCheckoutKey: idempotencyKey }))
                    throw error;
            });
            return { sessionId: session.id, url: session.url || successUrl.replace('{CHECKOUT_SESSION_ID}', session.id) };
        }
        await payment_model_1.Payment.create({
            userId: user.authId,
            mapId: payload.mapId,
            userEmail: user.email,
            amount,
            ...(((_h = session.automatic_tax) === null || _h === void 0 ? void 0 : _h.enabled) ? { subtotalAmount: ((_j = session.amount_subtotal) !== null && _j !== void 0 ? _j : Math.round(amount * 100)) / 100 } : {}),
            currency: currency.toUpperCase(),
            paymentMethod: 'stripe',
            paymentIntentId: session.payment_intent || session.id,
            status: 'pending',
            metadata: {
                checkoutSessionId: session.id,
                mapId: payload.mapId.toString(),
                ...payload.metadata,
            },
        });
        return {
            sessionId: session.id,
            url: session.url,
        };
    }
    catch (error) {
        if (error instanceof ApiError_1.default)
            throw error;
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Checkout session creation failed: ${error.message}`);
    }
};
const verifyCheckoutSession = async (sessionId) => {
    var _a, _b;
    try {
        // Retrieve session from Stripe
        const stripeSession = await stripe_1.default.checkout.sessions.retrieve(sessionId, {
            expand: ['payment_intent'],
        });
        const paymentIntentId = stripeSession.payment_intent &&
            typeof stripeSession.payment_intent === 'object'
            ? stripeSession.payment_intent.id
            : stripeSession.payment_intent;
        // Find payment record using either paymentIntentId (legacy/direct) or metadata.checkoutSessionId (correct for checkout)
        const payment = await payment_model_1.Payment.findOne({
            $or: [
                { paymentIntentId: sessionId },
                { 'metadata.checkoutSessionId': sessionId },
                ...(paymentIntentId ? [{ paymentIntentId }] : []),
            ],
        }).populate('userId', 'name email');
        if (!payment) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Payment not found');
        }
        if (payment.status === 'refunded') {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This payment was refunded');
        }
        // A PaymentIntent webhook may win the race. Still reconcile the tax breakdown.
        if (stripeSession.payment_status === 'paid' && payment.status === 'succeeded') {
            const changed = (0, stripePaymentTotals_1.applyStripeCheckoutTotals)(payment, stripeSession);
            const intentChanged = Boolean(paymentIntentId && payment.paymentIntentId !== paymentIntentId);
            if (paymentIntentId)
                payment.paymentIntentId = paymentIntentId;
            if (changed || intentChanged)
                await payment.save();
            return payment;
        }
        // Update payment status based on session
        if (stripeSession.payment_status === 'paid' &&
            payment.status !== 'succeeded') {
            const mongooseSession = await payment_model_1.Payment.startSession();
            mongooseSession.startTransaction();
            try {
                // Update payment status
                (0, stripePaymentTotals_1.applyStripeCheckoutTotals)(payment, stripeSession);
                payment.status = 'succeeded';
                if (paymentIntentId)
                    payment.paymentIntentId = paymentIntentId;
                payment.metadata = {
                    ...payment.metadata,
                    stripeSessionId: stripeSession.id,
                    paymentIntentId,
                };
                await payment.save({ session: mongooseSession });
                // Update User purchasedMaps if mapId exists
                const mapId = payment.mapId;
                if (mapId) {
                    await user_model_1.User.findByIdAndUpdate(payment.userId, { $addToSet: { purchasedMaps: mapId } }, { session: mongooseSession });
                    console.log(`verifyCheckoutSession: User purchasedMaps updated for User ID: ${payment.userId}`);
                }
                // Handle Promo Link usage if applicable
                const promoCode = ((_a = stripeSession.metadata) === null || _a === void 0 ? void 0 : _a.promoCode) || ((_b = payment.metadata) === null || _b === void 0 ? void 0 : _b.promoCode);
                if (promoCode) {
                    const claimedPromo = await promo_model_1.PromoLink.findOneAndUpdate({ code: promoCode, $or: [{ isUsed: false }, { usedBy: payment.userId }] }, {
                        isUsed: true,
                        usedBy: payment.userId,
                        usedAt: new Date(),
                    }, { session: mongooseSession });
                    if (!claimedPromo)
                        throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'This promo was claimed by another account. Your payment is retained; please contact support.');
                    console.log(`verifyCheckoutSession: PromoLink code: ${promoCode} marked as used`);
                }
                // Send confirmation email
                const user = await payment.populate('userId');
                const userData = user.userId;
                await mongooseSession.commitTransaction();
                if (userData) {
                    await emailHelper_1.emailHelper.sendEmail({
                        to: userData.email,
                        subject: 'Payment Successful',
                        html: payment.guestCheckoutKey
                            ? `<p>Your map purchase is ready.</p><p><a href="${config_1.default.clientUrl}/set-password?email=${encodeURIComponent(payment.userEmail)}">Verify your email and set a password</a> to return to your account later.</p>`
                            : `<p>Hi ${userData.name}, your payment of ${payment.amount} ${payment.currency} was successful.</p>`,
                    }).catch(error => console.error('Payment receipt email failed:', error));
                }
            }
            catch (error) {
                await mongooseSession.abortTransaction();
                throw error;
            }
            finally {
                mongooseSession.endSession();
            }
        }
        else if (stripeSession.payment_status === 'unpaid' &&
            payment.status === 'pending') {
            payment.status = 'failed';
            await payment.save();
        }
        return payment;
    }
    catch (error) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Payment verification failed: ${error.message}`);
    }
};
// ============================================
// FLUTTER STRIPE INTEGRATION METHODS
// ============================================
/**
 * Create Payment Intent for Flutter App
 * Used by flutter_stripe SDK for native mobile payments
 */
const createPaymentIntent = async (user, payload) => {
    var _a, _b;
    try {
        if ((_a = config_1.default.stripe) === null || _a === void 0 ? void 0 : _a.automaticTaxEnabled) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Please use secure Checkout for this purchase so applicable tax can be calculated from your billing address.');
        }
        // Same as checkout: charge Map.price server-side (never trust client amount)
        const map = await map_model_1.Map.findById(payload.mapId);
        if (!map) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
        }
        if (!map.isPaid) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This map is free and does not require checkout');
        }
        if (!map.price || map.price <= 0) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Map price is not configured');
        }
        const amount = map.price;
        const currency = MAP_PAYMENT_CURRENCY;
        const resolvedUserId = (_b = (user.authId || user.id || user._id)) === null || _b === void 0 ? void 0 : _b.toString();
        const paymentIntent = await stripe_1.default.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency,
            metadata: {
                userId: resolvedUserId,
                userEmail: user.email,
                mapId: payload.mapId.toString(),
                ...payload.metadata,
            },
        });
        // Create payment record
        await payment_model_1.Payment.create({
            userId: user.authId || user.id || user._id,
            mapId: payload.mapId,
            userEmail: user.email,
            amount,
            currency: currency.toUpperCase(),
            paymentMethod: 'stripe',
            paymentIntentId: paymentIntent.id,
            status: 'pending',
            metadata: {
                userId: resolvedUserId,
                mapId: payload.mapId.toString(),
                ...payload.metadata,
            },
        });
        return {
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            amount,
        };
    }
    catch (error) {
        if (error instanceof ApiError_1.default)
            throw error;
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Payment Intent creation failed: ${error.message}`);
    }
};
/**
 * Create Ephemeral Key for Flutter Stripe SDK
 * Required for customer-scoped operations in flutter_stripe
 */
const createEphemeralKey = async (user, apiVersion = '2025-05-28.basil') => {
    try {
        let customerId = user.stripeCustomerId;
        // Create customer if doesn't exist
        if (!customerId) {
            const customer = await stripe_1.default.customers.create({
                email: user.email,
                name: user.name,
                metadata: {
                    userId: user.authId.toString(),
                },
            });
            customerId = customer.id;
            // Update user record with stripeCustomerId
            await user_model_1.User.findByIdAndUpdate(user.authId, {
                stripeCustomerId: customer.id,
            });
        }
        // Create ephemeral key
        const ephemeralKey = await stripe_1.default.ephemeralKeys.create({ customer: customerId }, { apiVersion: apiVersion });
        return {
            ephemeralKey: ephemeralKey.secret,
        };
    }
    catch (error) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Ephemeral key creation failed: ${error.message}`);
    }
};
/**
 * Handle Payment Intent Webhook Events
 * Processes payment_intent.succeeded events from Stripe
 */
const handlePaymentIntentWebhook = async (paymentIntent) => {
    var _a;
    try {
        const payment = await payment_model_1.Payment.findOne({
            paymentIntentId: paymentIntent.id,
        });
        if (!payment) {
            console.error(`Payment not found for Payment Intent: ${paymentIntent.id}`);
            return;
        }
        if (payment.status === 'succeeded' || payment.status === 'refunded') {
            console.log(`Payment already processed: ${paymentIntent.id}`);
            return;
        }
        // Start MongoDB transaction
        const session = await payment_model_1.Payment.startSession();
        session.startTransaction();
        try {
            // Update payment status
            (0, stripePaymentTotals_1.applyStripeIntentTotal)(payment, paymentIntent);
            payment.status = 'succeeded';
            payment.metadata = {
                ...payment.metadata,
                processedAt: new Date().toISOString(),
            };
            await payment.save({ session });
            // Update User purchasedMaps if mapId exists
            const mapId = payment.mapId || ((_a = paymentIntent.metadata) === null || _a === void 0 ? void 0 : _a.mapId);
            if (mapId) {
                await user_model_1.User.findByIdAndUpdate(payment.userId, { $addToSet: { purchasedMaps: mapId } }, { session });
            }
            await session.commitTransaction();
            console.log(`Payment processed successfully: ${paymentIntent.id}`);
        }
        catch (error) {
            await session.abortTransaction();
            throw error;
        }
        finally {
            session.endSession();
        }
    }
    catch (error) {
        console.error(`Webhook processing failed: ${error.message}`);
        throw error;
    }
};
// ============================================
// EXISTING METHODS
// ============================================
const getAllPayments = async (user, filterables, pagination) => {
    const { searchTerm, ...filterData } = filterables;
    const { page, skip, limit, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(pagination);
    const andConditions = [];
    // Search functionality
    if (searchTerm) {
        andConditions.push({
            $or: payment_constants_1.paymentSearchableFields.map(field => ({
                [field]: {
                    $regex: searchTerm,
                    $options: 'i',
                },
            })),
        });
    }
    // Filter functionality
    if (Object.keys(filterData).length) {
        andConditions.push({
            $and: Object.entries(filterData).map(([key, value]) => ({
                [key]: value,
            })),
        });
    }
    // Non-admins can only see their own payments (JWT uses `role`, not `activeRole`)
    const role = user.role || user.activeRole;
    if (![user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN].includes(role)) {
        andConditions.push({
            userId: new mongoose_1.Types.ObjectId(user.authId),
        });
    }
    const whereConditions = andConditions.length ? { $and: andConditions } : {};
    const [result, total] = await Promise.all([
        payment_model_1.Payment.find(whereConditions)
            .skip(skip)
            .limit(limit)
            .sort({ [sortBy]: sortOrder })
            .populate('userId', 'name email')
            .populate({
            path: 'mapId',
        }),
        payment_model_1.Payment.countDocuments(whereConditions),
    ]);
    return {
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
        data: result,
    };
};
const getSinglePayment = async (id, user) => {
    var _a, _b, _c, _d;
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Payment ID');
    }
    const result = await payment_model_1.Payment.findById(id).populate('userId', 'name email');
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Requested payment not found, please try again with valid id');
    }
    if (user) {
        const role = user.role || user.activeRole;
        const isAdmin = [user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN].includes(role);
        const ownerId = ((_b = (_a = result.userId) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString()) || ((_c = result.userId) === null || _c === void 0 ? void 0 : _c.toString());
        if (!isAdmin && ownerId !== ((_d = user.authId) === null || _d === void 0 ? void 0 : _d.toString())) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized to view this payment');
        }
    }
    return result;
};
const updatePayment = async (id, payload) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Payment ID');
    }
    const result = await payment_model_1.Payment.findByIdAndUpdate(new mongoose_1.Types.ObjectId(id), { $set: payload }, {
        new: true,
        runValidators: true,
    }).populate('userId', 'name email');
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Requested payment not found, please try again with valid id');
    }
    return result;
};
const refundPayment = async (id, reason) => {
    var _a, _b;
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Payment ID');
    }
    const payment = await payment_model_1.Payment.findById(id);
    if (!payment) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Payment not found');
    }
    if (payment.status !== 'succeeded') {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Only successful payments can be refunded');
    }
    // Process refund via Stripe
    try {
        let intentId = payment.paymentIntentId;
        if (!intentId.startsWith('pi_')) {
            intentId = ((_a = payment.metadata) === null || _a === void 0 ? void 0 : _a.paymentIntentId) || intentId;
            if (intentId.startsWith('cs_')) {
                const checkout = await stripe_1.default.checkout.sessions.retrieve(intentId);
                intentId = typeof checkout.payment_intent === 'string'
                    ? checkout.payment_intent : ((_b = checkout.payment_intent) === null || _b === void 0 ? void 0 : _b.id) || '';
            }
        }
        const refund = await stripe_1.default.refunds.create({
            payment_intent: intentId,
            // Omitting amount refunds the remaining Stripe charge, including actual tax.
            reason: reason ? 'requested_by_customer' : 'duplicate',
        });
        const result = await payment_model_1.Payment.findByIdAndUpdate(id, {
            status: 'refunded',
            refundAmount: typeof refund.amount === 'number' ? refund.amount / 100 : payment.amount,
            refundReason: reason,
            metadata: { ...payment.metadata, refundId: refund.id },
        }, { new: true, runValidators: true }).populate('userId', 'name email');
        // Automatically remove user map access upon refund
        if (payment.userId && payment.mapId) {
            await user_model_1.User.findByIdAndUpdate(payment.userId, {
                $pull: { purchasedMaps: payment.mapId },
                $addToSet: { deactivatedMaps: payment.mapId },
            });
        }
        return result;
    }
    catch (error) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Refund failed: ${error.message}`);
    }
};
const getMyPayments = async (user, pagination) => {
    const { page, skip, limit, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(pagination);
    const [result, total] = await Promise.all([
        payment_model_1.Payment.find({ userId: new mongoose_1.Types.ObjectId(user.authId) })
            .skip(skip)
            .limit(limit)
            .sort({ [sortBy]: sortOrder })
            .populate('userId', 'name email'),
        payment_model_1.Payment.countDocuments({ userId: new mongoose_1.Types.ObjectId(user.authId) }),
    ]);
    return {
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
        data: result,
    };
};
const generateInvoice = async (id) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid Payment ID');
    }
    const payment = await payment_model_1.Payment.findById(id)
        .populate('userId')
        .populate('mapId');
    if (!payment) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Payment not found');
    }
    // 1. If it's a Stripe payment, try to get the official receipt URL
    if (payment.paymentIntentId &&
        payment.status === 'succeeded' &&
        payment.paymentMethod === 'stripe') {
        try {
            const pi = await stripe_1.default.paymentIntents.retrieve(payment.paymentIntentId);
            if (pi.latest_charge) {
                const charge = await stripe_1.default.charges.retrieve(pi.latest_charge);
                if (charge.receipt_url) {
                    return charge.receipt_url;
                }
            }
        }
        catch (error) {
            console.error('Failed to fetch stripe receipt:', error);
        }
    }
    // 2. Fallback to custom PDF invoice generation
    return await (0, invoiceHelper_1.generatePDFInvoice)(payment);
};
exports.PaymentServices = {
    getAllPayments,
    getSinglePayment,
    updatePayment,
    refundPayment,
    getMyPayments,
    createCheckoutSession,
    verifyCheckoutSession,
    handleWebhook: webhook_service_1.WebhookService.handleWebhook,
    createPaymentIntent,
    createEphemeralKey,
    handlePaymentIntentWebhook,
    generateInvoice,
};
