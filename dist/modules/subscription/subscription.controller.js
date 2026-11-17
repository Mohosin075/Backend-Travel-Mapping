"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionController = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const subscription_service_1 = require("./subscription.service");
const webhook_service_1 = require("./webhook.service");
const localize_1 = require("../../helpers/localize");
const planFields = [
    'name',
    'description',
    'features',
    'planId.name',
    'planId.description',
    'planId.features',
];
// Get available subscription plans
const getAvailablePlans = (0, catchAsync_1.default)(async (req, res) => {
    const plans = await subscription_service_1.subscriptionService.getAvailablePlans();
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription plans retrieved successfully',
        data: (0, localize_1.localizeDocument)(plans, req.lang, planFields),
    });
});
// Get specific plan by ID
const getPlanById = (0, catchAsync_1.default)(async (req, res) => {
    const { planId } = req.params;
    const plan = await subscription_service_1.subscriptionService.getPlanById(planId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription plan retrieved successfully',
        data: (0, localize_1.localizeDocument)(plan, req.lang, planFields),
    });
});
// Check trial eligibility
const checkTrialEligibility = (0, catchAsync_1.default)(async (req, res) => {
    var _a;
    const user = req.user;
    const userId = req.params.userId || ((_a = user.authId) === null || _a === void 0 ? void 0 : _a.toString());
    const trialInfo = await subscription_service_1.subscriptionService.checkTrialEligibility(userId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Trial eligibility checked successfully',
        data: trialInfo,
    });
});
// Create subscription
const createSubscription = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const result = await subscription_service_1.subscriptionService.createSubscription(userId, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Subscription created successfully',
        data: result,
    });
});
// Get user's current subscription(s)
const getUserSubscription = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { businessId } = req.query;
    if (businessId) {
        const subscription = await subscription_service_1.subscriptionService.getUserSubscription(userId, businessId);
        (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.OK,
            success: true,
            message: subscription
                ? 'Subscription retrieved successfully'
                : 'No active subscription found',
            data: subscription ? (0, localize_1.localizeDocument)(subscription, req.lang, planFields) : {},
        });
    }
    else {
        const subscriptions = await subscription_service_1.subscriptionService.getUserSubscriptions(userId);
        (0, sendResponse_1.default)(res, {
            statusCode: http_status_codes_1.StatusCodes.OK,
            success: true,
            message: subscriptions.length > 0
                ? 'Subscriptions retrieved successfully'
                : 'No active subscription found',
            data: (0, localize_1.localizeDocument)(subscriptions, req.lang, planFields),
        });
    }
});
// Update subscription
const updateSubscription = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { subscriptionId } = req.params;
    const subscription = await subscription_service_1.subscriptionService.updateSubscription(userId, subscriptionId, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription updated successfully',
        data: subscription,
    });
});
// Cancel subscription
const cancelSubscription = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { subscriptionId } = req.params;
    const { cancelAtPeriodEnd = true } = req.body;
    const subscription = await subscription_service_1.subscriptionService.cancelSubscription(userId, subscriptionId, cancelAtPeriodEnd);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription canceled successfully',
        data: subscription,
    });
});
// Get subscription status
const getSubscriptionStatus = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { businessId } = req.query;
    const status = await subscription_service_1.subscriptionService.getSubscriptionStatus(userId, businessId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription status retrieved successfully',
        data: status,
    });
});
// Create checkout session
const createCheckoutSession = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { planId, businessId, successUrl, cancelUrl } = req.body;
    const session = await subscription_service_1.subscriptionService.createCheckoutSession(userId, planId, businessId, successUrl, cancelUrl);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Checkout session created successfully',
        data: session,
    });
});
const verifyCheckoutSession = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const sessionId = req.query.sessionId;
    const result = await subscription_service_1.subscriptionService.verifyCheckoutSession(userId, sessionId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: result.hasActiveSubscription
            ? 'Subscription verified successfully'
            : 'Checkout verified, but subscription is not active yet',
        data: result,
    });
});
// Handle Stripe webhooks
const handleWebhook = (0, catchAsync_1.default)(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const payload = req.body;
    // Verify webhook signature and construct event
    const event = webhook_service_1.webhookService.verifyWebhookSignature(payload, signature);
    // Process the webhook event
    await webhook_service_1.webhookService.processWebhookEvent(event);
    // Respond to Stripe
    res.status(http_status_codes_1.StatusCodes.OK).json({ received: true });
});
// Admin: Create subscription plan
const createSubscriptionPlan = (0, catchAsync_1.default)(async (req, res) => {
    const plan = await subscription_service_1.subscriptionService.createSubscriptionPlan(req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.CREATED,
        success: true,
        message: 'Subscription plan created successfully',
        data: (0, localize_1.localizeDocument)(plan, req.lang, planFields),
    });
});
// Admin: Update subscription plan
const updateSubscriptionPlan = (0, catchAsync_1.default)(async (req, res) => {
    const { planId } = req.params;
    const plan = await subscription_service_1.subscriptionService.updateSubscriptionPlan(planId, req.body);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription plan updated successfully',
        data: (0, localize_1.localizeDocument)(plan, req.lang, planFields),
    });
});
// Admin: Delete subscription plan (soft delete)
const deleteSubscriptionPlan = (0, catchAsync_1.default)(async (req, res) => {
    const { planId } = req.params;
    const plan = await subscription_service_1.subscriptionService.deleteSubscriptionPlan(planId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription plan deleted successfully',
        data: plan,
    });
});
// Admin: Get all plans (including inactive)
const getAllPlans = (0, catchAsync_1.default)(async (req, res) => {
    // For admin, get all plans including inactive ones
    const plans = await subscription_service_1.subscriptionService.getAvailablePlans();
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'All subscription plans retrieved successfully',
        data: (0, localize_1.localizeDocument)(plans, req.lang, planFields),
    });
});
// Admin: Get all user subscriptions
const getAllSubscriptions = (0, catchAsync_1.default)(async (req, res) => {
    const result = await subscription_service_1.subscriptionService.getAllSubscriptions(req.query);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'All subscriptions retrieved successfully',
        meta: result.meta,
        data: result.result,
    });
});
// Admin: Get subscription analytics
const getSubscriptionAnalytics = (0, catchAsync_1.default)(async (req, res) => {
    const { startDate, endDate, planId, status } = req.query;
    const filters = {};
    if (startDate)
        filters.startDate = new Date(startDate);
    if (endDate)
        filters.endDate = new Date(endDate);
    if (planId)
        filters.planId = planId;
    if (status)
        filters.status = status;
    const analytics = await subscription_service_1.subscriptionService.getSubscriptionAnalytics(filters);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription analytics retrieved successfully',
        data: analytics,
    });
});
// Reactivate canceled subscription
const reactivateSubscription = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { subscriptionId } = req.params;
    const subscription = await subscription_service_1.subscriptionService.reactivateSubscription(userId, subscriptionId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription reactivated successfully',
        data: subscription,
    });
});
// Retry failed payment
const retryFailedPayment = (0, catchAsync_1.default)(async (req, res) => {
    const { subscriptionId } = req.params;
    await subscription_service_1.subscriptionService.retryFailedPayment(subscriptionId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Payment retry initiated successfully',
        data: null,
    });
});
// Pause subscription
const pauseSubscription = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { subscriptionId } = req.params;
    const subscription = await subscription_service_1.subscriptionService.pauseSubscription(userId, subscriptionId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription paused successfully',
        data: subscription,
    });
});
// Resume subscription
const resumeSubscription = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { subscriptionId } = req.params;
    const subscription = await subscription_service_1.subscriptionService.resumeSubscription(userId, subscriptionId);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Subscription resumed successfully',
        data: subscription,
    });
});
// Get usage data
const getUsageData = (0, catchAsync_1.default)(async (req, res) => {
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Usage data retrieved successfully',
        data: {},
    });
});
// Check usage warnings
const getUsageWarnings = (0, catchAsync_1.default)(async (req, res) => {
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Usage warnings retrieved successfully',
        data: { warnings: [], suggestions: [] },
    });
});
// Get billing portal session
const createBillingPortal = (0, catchAsync_1.default)(async (req, res) => {
    const user = req.user;
    const userId = user.authId.toString();
    const { returnUrl } = req.body;
    const portalSession = await subscription_service_1.subscriptionService.createBillingPortalSession(userId, returnUrl);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Billing portal session created successfully',
        data: portalSession,
    });
});
exports.SubscriptionController = {
    // Public endpoints
    getAvailablePlans,
    getPlanById,
    // User endpoints (require authentication)
    checkTrialEligibility,
    createSubscription,
    getUserSubscription,
    updateSubscription,
    cancelSubscription,
    getSubscriptionStatus,
    createCheckoutSession,
    verifyCheckoutSession,
    reactivateSubscription,
    pauseSubscription,
    resumeSubscription,
    getUsageData,
    getUsageWarnings,
    createBillingPortal,
    // Webhook endpoint
    handleWebhook,
    // Admin endpoints (require admin role)
    createSubscriptionPlan,
    updateSubscriptionPlan,
    deleteSubscriptionPlan,
    getAllPlans,
    getAllSubscriptions,
    getSubscriptionAnalytics,
    retryFailedPayment,
};
