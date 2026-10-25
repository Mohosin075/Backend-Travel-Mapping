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
const createCheckoutSession = async (user, payload) => {
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
        const currency = (payload.currency || 'EUR').toLowerCase();
        const session = await stripe_1.default.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency,
                        product_data: {
                            name: payload.productName || map.name || 'Map Purchase',
                            description: payload.description || map.description,
                        },
                        unit_amount: Math.round(amount * 100),
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: payload.successUrl ||
                `${config_1.default.clientUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`,
            cancel_url: payload.cancelUrl ||
                `${config_1.default.clientUrl}/payment-failed?success=false`,
            customer_email: user.email,
            metadata: {
                userId: user.authId.toString(),
                mapId: payload.mapId.toString(),
                ...payload.metadata,
            },
        });
        await payment_model_1.Payment.create({
            userId: user.authId,
            mapId: payload.mapId,
            userEmail: user.email,
            amount,
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
        console.log('🔍 Verifying Checkout Session:', stripeSession.id);
        console.log('🔍 Payment Intent:', stripeSession.payment_intent);
        console.log('🔍 Metadata:', stripeSession.metadata);
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
        // Update payment status based on session
        if (stripeSession.payment_status === 'paid' &&
            payment.status !== 'succeeded') {
            const mongooseSession = await payment_model_1.Payment.startSession();
            mongooseSession.startTransaction();
            try {
                // Update payment status
                payment.status = 'succeeded';
                payment.metadata = {
                    ...payment.metadata,
                    stripeSessionId: stripeSession.id,
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
                    await promo_model_1.PromoLink.findOneAndUpdate({ code: promoCode, isUsed: false }, {
                        isUsed: true,
                        usedBy: payment.userId,
                        usedAt: new Date(),
                    }, { session: mongooseSession });
                    console.log(`verifyCheckoutSession: PromoLink code: ${promoCode} marked as used`);
                }
                // Send confirmation email
                const user = await payment.populate('userId');
                const userData = user.userId;
                if (userData) {
                    await emailHelper_1.emailHelper.sendEmail({
                        to: userData.email,
                        subject: 'Payment Successful',
                        html: `<p>Hi ${userData.name}, your payment of ${payment.amount} ${payment.currency} was successful.</p>`,
                    });
                }
                await mongooseSession.commitTransaction();
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
            payment.status !== 'failed') {
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
    var _a;
    try {
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
        const currency = (payload.currency || 'eur').toLowerCase();
        const resolvedUserId = (_a = (user.authId || user.id || user._id)) === null || _a === void 0 ? void 0 : _a.toString();
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
        if (payment.status === 'succeeded') {
            console.log(`Payment already processed: ${paymentIntent.id}`);
            return;
        }
        // Start MongoDB transaction
        const session = await payment_model_1.Payment.startSession();
        session.startTransaction();
        try {
            // Update payment status
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
        const refund = await stripe_1.default.refunds.create({
            payment_intent: payment.paymentIntentId,
            amount: Math.round(payment.amount * 100),
            reason: reason ? 'requested_by_customer' : 'duplicate',
        });
        const result = await payment_model_1.Payment.findByIdAndUpdate(id, {
            status: 'refunded',
            refundAmount: payment.amount,
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
