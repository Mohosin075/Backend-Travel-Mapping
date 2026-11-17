"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuestCheckoutController = void 0;
const crypto_1 = require("crypto");
const zod_1 = require("zod");
const http_status_codes_1 = require("http-status-codes");
const config_1 = __importDefault(require("../../config"));
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const user_1 = require("../../enum/user");
const user_model_1 = require("../user/user.model");
const map_model_1 = require("../map/map.model");
const auth_helper_1 = require("../auth/auth.helper");
const guest_checkout_model_1 = require("./guest-checkout.model");
const payment_model_1 = require("./payment.model");
const payment_service_1 = require("./payment.service");
const stripe_1 = __importDefault(require("../../config/stripe"));
const checkoutOrigin_1 = require("../../helpers/checkoutOrigin");
const stripePaymentTotals_1 = require("../../helpers/stripePaymentTotals");
const tokenSchema = zod_1.z.string().regex(/^[a-f0-9]{64}$/);
const startSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email().max(254).transform(value => value.toLowerCase()),
    mapId: zod_1.z.string().regex(/^[a-f0-9]{24}$/i).transform(value => value.toLowerCase()),
    checkoutToken: tokenSchema,
});
const completeSchema = zod_1.z.object({ checkoutToken: tokenSchema, sessionId: zod_1.z.string().regex(/^cs_[a-zA-Z0-9_]+$/).max(255) });
const hash = (token) => (0, crypto_1.createHash)('sha256').update(token).digest('hex');
const loginRequired = (res) => (0, sendResponse_1.default)(res, {
    statusCode: http_status_codes_1.StatusCodes.OK, success: true,
    message: 'Please sign in or verify your email to continue.', data: { loginRequired: true },
});
const start = (0, catchAsync_1.default)(async (req, res) => {
    var _a;
    const payload = startSchema.parse(req.body);
    // Browser Origin is checked against server configuration, never a body URL
    // or forwarded Host. Preserve it so Stripe returns to the same browser storage.
    const returnOrigin = (0, checkoutOrigin_1.getCheckoutReturnOrigin)((_a = req.headers) === null || _a === void 0 ? void 0 : _a.origin);
    // Do not accept new guest purchases until the uniqueness indexes are ready.
    await Promise.all([guest_checkout_model_1.GuestCheckout.init(), payment_model_1.Payment.init()]);
    const tokenHash = hash(payload.checkoutToken);
    const map = await map_model_1.Map.findById(payload.mapId);
    if (!map || map.status !== 'Published' || !map.isActive || !map.isPaid || !map.price || map.price <= 0) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This map is not available for purchase.');
    }
    const attempt = await guest_checkout_model_1.GuestCheckout.findOne({ tokenHash });
    // New purchases require normal registration/login. Keep only the resume path
    // for capabilities issued before the rollback, including interrupted creation.
    if (!attempt)
        return loginRequired(res);
    if (attempt.returnOrigin && attempt.returnOrigin !== returnOrigin) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Resume checkout on the website where it was started, or sign in to recover your purchase.');
    }
    if (attempt.email !== payload.email || String(attempt.mapId) !== payload.mapId ||
        attempt.expiresAt <= new Date() || attempt.redeemedAt)
        return loginRequired(res);
    const user = await user_model_1.User.findById(attempt.userId);
    if (!user || user.status !== user_1.USER_STATUS.ACTIVE || user.role !== user_1.USER_ROLES.USER ||
        user.provider !== 'guest_purchase' || user.password || user.verified || user.appId)
        return loginRequired(res);
    if (attempt.sessionId) {
        const session = await stripe_1.default.checkout.sessions.retrieve(attempt.sessionId);
        if (session.status === 'expired')
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Checkout expired. Verify your email and sign in to try again.');
        const url = session.url || `${returnOrigin}/catalog/checkout?mapId=${map._id}&session_id=${session.id}`;
        return (0, sendResponse_1.default)(res, { statusCode: http_status_codes_1.StatusCodes.OK, success: true, message: 'Checkout ready', data: { sessionId: session.id, url } });
    }
    // A deterministic Stripe key recovers checkout creation if the response or
    // database write was interrupted. Client data cannot set price or metadata.
    const result = await payment_service_1.PaymentServices.createCheckoutSession({ authId: user._id, email: user.email }, {
        mapId: String(map._id),
        successUrl: `${returnOrigin}/catalog/checkout?mapId=${map._id}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${returnOrigin}/catalog/checkout?mapId=${map._id}&cancelled=1`,
    }, `guest-${user._id}-${tokenHash}`);
    attempt.sessionId = result.sessionId;
    await attempt.save();
    (0, sendResponse_1.default)(res, { statusCode: http_status_codes_1.StatusCodes.OK, success: true, message: 'Checkout ready', data: result });
});
const complete = (0, catchAsync_1.default)(async (req, res) => {
    var _a, _b, _c;
    const { checkoutToken, sessionId } = completeSchema.parse(req.body);
    const attempt = await guest_checkout_model_1.GuestCheckout.findOne({ tokenHash: hash(checkoutToken), sessionId,
        expiresAt: { $gt: new Date() }, redeemedAt: { $exists: false } });
    if (!attempt)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Checkout expired or already used. Sign in or verify your email to access your purchase.');
    if (attempt.returnOrigin && attempt.returnOrigin !== (0, checkoutOrigin_1.getCheckoutReturnOrigin)((_a = req.headers) === null || _a === void 0 ? void 0 : _a.origin)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Return to the website where checkout was started to verify this purchase.');
    }
    const session = await stripe_1.default.checkout.sessions.retrieve(sessionId);
    const payment = await payment_model_1.Payment.findOne({ 'metadata.checkoutSessionId': sessionId, userId: attempt.userId, mapId: attempt.mapId });
    if (!payment || session.payment_status !== 'paid' || session.status !== 'complete' ||
        ((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.userId) !== String(attempt.userId) || ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.mapId) !== String(attempt.mapId) ||
        !(0, stripePaymentTotals_1.checkoutMatchesPaymentTotal)(payment, session) ||
        payment.status === 'refunded') {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Payment is not complete or is no longer available. Please retry or contact support.');
    }
    // Fulfilment also works when the browser returns before the webhook.
    await payment_service_1.PaymentServices.verifyCheckoutSession(sessionId);
    const user = await user_model_1.User.findById(attempt.userId);
    if (!user || user.status !== user_1.USER_STATUS.ACTIVE || user.role !== user_1.USER_ROLES.USER ||
        user.provider !== 'guest_purchase' || user.password || user.verified || user.appId)
        return loginRequired(res);
    const redeemed = await guest_checkout_model_1.GuestCheckout.findOneAndUpdate({ _id: attempt._id, redeemedAt: { $exists: false } }, { $set: { redeemedAt: new Date() } }, { new: true });
    if (!redeemed)
        return loginRequired(res);
    const tokens = auth_helper_1.AuthHelper.createToken(user._id, user.role, user.name, user.email);
    res.cookie('refreshToken', tokens.refreshToken, { secure: config_1.default.node_env === 'production', httpOnly: true,
        sameSite: config_1.default.node_env === 'production' ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    // Payment proves purchase, not ownership of the typed email. Keep verified=false.
    (0, sendResponse_1.default)(res, { statusCode: http_status_codes_1.StatusCodes.OK, success: true, message: 'Purchase ready',
        data: { accessToken: tokens.accessToken, mapId: String(attempt.mapId) } });
});
exports.GuestCheckoutController = { start, complete };
