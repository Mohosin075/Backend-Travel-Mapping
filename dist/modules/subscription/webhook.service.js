"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookService = void 0;
const http_status_codes_1 = require("http-status-codes");
const mongoose_1 = require("mongoose");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const stripe_service_1 = require("./stripe.service");
const subscription_model_1 = require("./subscription.model");
const subscription_plan_model_1 = require("./subscription-plan.model");
const user_model_1 = require("../user/user.model");
const business_model_1 = require("../business/business.model");
class WebhookService {
    // Process webhook events with idempotency
    async processWebhookEvent(event) {
        try {
            // Check for duplicate events (idempotency)
            const existingSubscription = await subscription_model_1.Subscription.findOne({
                lastWebhookEventId: event.id,
            });
            if (existingSubscription) {
                console.log(`Webhook event already processed: ${event.id}`);
                return;
            }
            console.log(`Processing webhook event: ${event.type} - ${event.id}`);
            switch (event.type) {
                case 'customer.subscription.created':
                    await this.handleSubscriptionCreated(event.data.object, event.id);
                    break;
                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdated(event.data.object, event.id);
                    break;
                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event.data.object, event.id);
                    break;
                case 'customer.subscription.trial_will_end':
                    await this.handleTrialWillEnd(event.data.object, event.id);
                    break;
                case 'invoice.payment_succeeded':
                    await this.handlePaymentSucceeded(event.data.object, event.id);
                    break;
                case 'invoice.payment_failed':
                    await this.handlePaymentFailed(event.data.object, event.id);
                    break;
                case 'invoice.upcoming':
                    await this.handleUpcomingInvoice(event.data.object, event.id);
                    break;
                case 'checkout.session.completed':
                    await this.handleCheckoutCompleted(event.data.object, event.id);
                    break;
                // Product and Price Management Events
                case 'product.updated':
                    await this.handleProductUpdated(event.data.object, event.id);
                    break;
                case 'product.deleted':
                    await this.handleProductDeleted(event.data.object, event.id);
                    break;
                case 'price.updated':
                    await this.handlePriceUpdated(event.data.object, event.id);
                    break;
                case 'price.deleted':
                    await this.handlePriceDeleted(event.data.object, event.id);
                    break;
                // Payment Method Events
                case 'payment_method.attached':
                    await this.handlePaymentMethodAttached(event.data.object, event.id);
                    break;
                case 'customer.updated':
                    await this.handleCustomerUpdated(event.data.object, event.id);
                    break;
                case 'customer.deleted':
                    await this.handleCustomerDeleted(event.data.object, event.id);
                    break;
                // Dispute and Chargeback Events
                case 'charge.dispute.created':
                    await this.handleDisputeCreated(event.data.object, event.id);
                    break;
                // Additional Important Events
                case 'invoice.created':
                    await this.handleInvoiceCreated(event.data.object, event.id);
                    break;
                case 'invoice.finalized':
                    await this.handleInvoiceFinalized(event.data.object, event.id);
                    break;
                case 'payment_intent.succeeded':
                    await this.handlePaymentIntentSucceeded(event.data.object, event.id);
                    break;
                case 'payment_intent.payment_failed':
                    await this.handlePaymentIntentFailed(event.data.object, event.id);
                    break;
                case 'customer.subscription.paused':
                    await this.handleSubscriptionPaused(event.data.object, event.id);
                    break;
                case 'customer.subscription.resumed':
                    await this.handleSubscriptionResumed(event.data.object, event.id);
                    break;
                case 'setup_intent.succeeded':
                    await this.handleSetupIntentSucceeded(event.data.object, event.id);
                    break;
                case 'payment_method.automatically_updated':
                    await this.handlePaymentMethodUpdated(event.data.object, event.id);
                    break;
                default:
                    console.log(`Unhandled webhook event type: ${event.type}`);
            }
        }
        catch (error) {
            console.error(`Error processing webhook event ${event.id}:`, error);
            throw error;
        }
    }
    // Handle subscription created
    async handleSubscriptionCreated(stripeSubscription, eventId) {
        var _a, _b, _c;
        try {
            const userId = (_a = stripeSubscription.metadata) === null || _a === void 0 ? void 0 : _a.userId;
            const businessId = (_b = stripeSubscription.metadata) === null || _b === void 0 ? void 0 : _b.businessId;
            if (!userId) {
                console.error('No userId in subscription metadata');
                return;
            }
            // Check if subscription already exists
            const existingSubscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: stripeSubscription.id,
            });
            if (existingSubscription) {
                const existingBusinessId = businessId || ((_c = existingSubscription.businessId) === null || _c === void 0 ? void 0 : _c.toString());
                const isActive = ['active', 'trialing'].includes(stripeSubscription.status);
                if (existingBusinessId) {
                    const priceId = typeof stripeSubscription.items.data[0].price === 'string'
                        ? stripeSubscription.items.data[0].price
                        : stripeSubscription.items.data[0].price.id;
                    const existingPlan = await subscription_plan_model_1.SubscriptionPlan.findOne({
                        stripePriceId: priceId,
                    });
                    await business_model_1.Business.findByIdAndUpdate(existingBusinessId, {
                        hasActiveSubscription: isActive,
                        ...(existingPlan ? { plan: existingPlan._id } : {}),
                    });
                }
                console.log(`Subscription already exists: ${stripeSubscription.id}`);
                return;
            }
            // Find the plan by Stripe price ID
            const priceId = typeof stripeSubscription.items.data[0].price === 'string'
                ? stripeSubscription.items.data[0].price
                : stripeSubscription.items.data[0].price.id;
            const plan = await subscription_plan_model_1.SubscriptionPlan.findOne({
                stripePriceId: priceId,
            });
            if (!plan) {
                console.error(`Plan not found for price ID: ${priceId}`);
                return;
            }
            // Create subscription record
            // In newer Stripe API versions (like 2025-08-27.basil), current_period_start/end are moved to items.data[0]
            const subscriptionItem = stripeSubscription.items.data[0];
            const currentPeriodStart = stripeSubscription.current_period_start ||
                subscriptionItem.current_period_start;
            const currentPeriodEnd = stripeSubscription.current_period_end ||
                subscriptionItem.current_period_end;
            const subscription = new subscription_model_1.Subscription({
                userId: new mongoose_1.Types.ObjectId(userId),
                businessId: businessId ? new mongoose_1.Types.ObjectId(businessId) : undefined,
                planId: plan._id,
                stripeCustomerId: stripeSubscription.customer,
                stripeSubscriptionId: stripeSubscription.id,
                stripePriceId: stripeSubscription.items.data[0].price.id,
                status: stripeSubscription.status,
                currentPeriodStart: currentPeriodStart
                    ? new Date(currentPeriodStart * 1000)
                    : new Date(),
                currentPeriodEnd: currentPeriodEnd
                    ? new Date(currentPeriodEnd * 1000)
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                trialStart: stripeSubscription.trial_start
                    ? new Date(stripeSubscription.trial_start * 1000)
                    : null,
                trialEnd: stripeSubscription.trial_end
                    ? new Date(stripeSubscription.trial_end * 1000)
                    : null,
                hasUsedTrial: !!stripeSubscription.trial_start,
                lastWebhookEventId: eventId,
                metadata: new Map(Object.entries(stripeSubscription.metadata || {})),
            });
            await subscription.save();
            // Update user profile with customer and trial info
            await user_model_1.User.findByIdAndUpdate(userId, {
                stripeCustomerId: stripeSubscription.customer,
                trialUsed: !!stripeSubscription.trial_start,
            });
            // Update business hasActiveSubscription
            const isActive = ['active', 'trialing'].includes(stripeSubscription.status);
            if (businessId) {
                await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: isActive, plan: plan._id });
            }
            // Send welcome email
            const { emailNotificationService } = await Promise.resolve().then(() => __importStar(require('./email-notification.service')));
            await emailNotificationService.sendSubscriptionWelcomeEmail(subscription, plan, !!stripeSubscription.trial_start);
            console.log(`Subscription created from webhook: ${subscription._id}`);
            console.log(`User profile updated for user: ${userId}`);
        }
        catch (error) {
            console.error('Error handling subscription created:', error);
            throw error;
        }
    }
    // Handle subscription updated
    async handleSubscriptionUpdated(stripeSubscription, eventId) {
        var _a;
        try {
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: stripeSubscription.id,
            });
            if (!subscription) {
                console.error(`Subscription not found: ${stripeSubscription.id}`);
                return;
            }
            // Update subscription data
            // In newer Stripe API versions (like 2025-08-27.basil), current_period_start/end are moved to items.data[0]
            const subscriptionItem = stripeSubscription.items.data[0];
            const currentPeriodStart = stripeSubscription.current_period_start ||
                subscriptionItem.current_period_start;
            const currentPeriodEnd = stripeSubscription.current_period_end ||
                subscriptionItem.current_period_end;
            const updateData = {
                status: stripeSubscription.status,
                currentPeriodStart: currentPeriodStart
                    ? new Date(currentPeriodStart * 1000)
                    : undefined,
                currentPeriodEnd: currentPeriodEnd
                    ? new Date(currentPeriodEnd * 1000)
                    : undefined,
                cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                lastWebhookEventId: eventId,
            };
            // Handle trial updates
            if (stripeSubscription.trial_start) {
                updateData.trialStart = new Date(stripeSubscription.trial_start * 1000);
                updateData.hasUsedTrial = true;
            }
            if (stripeSubscription.trial_end) {
                updateData.trialEnd = new Date(stripeSubscription.trial_end * 1000);
            }
            // Handle cancellation
            if (stripeSubscription.canceled_at) {
                updateData.canceledAt = new Date(stripeSubscription.canceled_at * 1000);
            }
            if (stripeSubscription.ended_at) {
                updateData.endedAt = new Date(stripeSubscription.ended_at * 1000);
            }
            // Handle plan changes
            const newPrice = stripeSubscription.items.data[0].price;
            const newPriceId = typeof newPrice === 'string' ? newPrice : newPrice.id;
            let newTier;
            if (subscription.stripePriceId !== newPriceId) {
                const newPlan = await subscription_plan_model_1.SubscriptionPlan.findOne({
                    stripePriceId: newPriceId,
                });
                if (newPlan) {
                    updateData.planId = newPlan._id;
                    updateData.stripePriceId = newPriceId;
                    newTier = this.getSubscriptionTier(newPlan.name);
                }
            }
            const businessId = subscription.businessId || ((_a = stripeSubscription.metadata) === null || _a === void 0 ? void 0 : _a.businessId);
            if (businessId && !subscription.businessId) {
                updateData.businessId = new mongoose_1.Types.ObjectId(businessId);
            }
            await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, updateData);
            // Update user profile with trial usage info
            await user_model_1.User.findByIdAndUpdate(subscription.userId, {
                trialUsed: !!stripeSubscription.trial_start,
            });
            // Update business hasActiveSubscription
            const isActive = ['active', 'trialing'].includes(stripeSubscription.status);
            if (businessId) {
                await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: isActive });
            }
            console.log(`Subscription updated from webhook: ${subscription._id}`);
            console.log(`User profile updated for user: ${subscription.userId}`);
        }
        catch (error) {
            console.error('Error handling subscription updated:', error);
            throw error;
        }
    }
    // Handle subscription deleted
    async handleSubscriptionDeleted(stripeSubscription, eventId) {
        var _a;
        try {
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: stripeSubscription.id,
            });
            if (!subscription) {
                console.error(`Subscription not found: ${stripeSubscription.id}`);
                return;
            }
            await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                status: 'canceled',
                endedAt: new Date(),
                lastWebhookEventId: eventId,
            });
            // No user-level subscription status updates are needed
            // Update business hasActiveSubscription
            const businessId = subscription.businessId || ((_a = stripeSubscription.metadata) === null || _a === void 0 ? void 0 : _a.businessId);
            if (businessId) {
                await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: false });
            }
            // Send cancellation email
            const { emailNotificationService } = await Promise.resolve().then(() => __importStar(require('./email-notification.service')));
            const plan = await subscription_plan_model_1.SubscriptionPlan.findById(subscription.planId);
            if (plan) {
                await emailNotificationService.sendSubscriptionCanceledEmail(subscription, plan, new Date());
            }
            console.log(`Subscription deleted from webhook: ${subscription._id}`);
        }
        catch (error) {
            console.error('Error handling subscription deleted:', error);
            throw error;
        }
    }
    // Handle trial will end (3 days before trial ends)
    async handleTrialWillEnd(stripeSubscription, eventId) {
        try {
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: stripeSubscription.id,
            }).populate(['userId', 'planId']);
            if (!subscription) {
                console.error(`Subscription not found: ${stripeSubscription.id}`);
                return;
            }
            // Update webhook event ID
            await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                lastWebhookEventId: eventId,
            });
            // Send trial ending email
            const { emailNotificationService } = await Promise.resolve().then(() => __importStar(require('./email-notification.service')));
            const daysLeft = Math.ceil((subscription.trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            await emailNotificationService.sendTrialEndingEmail(subscription, subscription.planId, daysLeft);
            console.log(`Trial will end notification sent for subscription: ${subscription._id}`);
        }
        catch (error) {
            console.error('Error handling trial will end:', error);
            throw error;
        }
    }
    // Handle successful payment
    async handlePaymentSucceeded(invoice, eventId) {
        var _a;
        try {
            const invoiceWithSubscription = invoice;
            if (!invoiceWithSubscription.subscription) {
                console.log('Invoice not related to subscription');
                return;
            }
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: invoiceWithSubscription.subscription,
            });
            if (!subscription) {
                console.error(`Subscription not found: ${invoiceWithSubscription.subscription}`);
                return;
            }
            // Fetch the latest subscription to get accurate status
            const stripeSubscription = await stripe_service_1.stripeService.getSubscription(invoiceWithSubscription.subscription);
            // Update payment information
            await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                status: stripeSubscription.status, // Use the actual status from Stripe (trialing or active)
                lastPaymentDate: new Date(invoice.status_transitions.paid_at * 1000),
                paymentFailureCount: 0,
                lastWebhookEventId: eventId,
            });
            // No user-level status updates needed on payment success
            // Update business hasActiveSubscription
            const businessId = subscription.businessId || ((_a = stripeSubscription.metadata) === null || _a === void 0 ? void 0 : _a.businessId);
            const isActive = ['active', 'trialing'].includes(stripeSubscription.status);
            if (businessId) {
                await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: isActive });
            }
            // Send payment success email
            const { emailNotificationService } = await Promise.resolve().then(() => __importStar(require('./email-notification.service')));
            await emailNotificationService.sendPaymentSuccessEmail(subscription, invoice);
            console.log(`Payment succeeded for subscription: ${subscription._id}`);
        }
        catch (error) {
            console.error('Error handling payment succeeded:', error);
            throw error;
        }
    }
    // Handle failed payment
    async handlePaymentFailed(invoice, eventId) {
        try {
            const invoiceWithSubscription = invoice;
            if (!invoiceWithSubscription.subscription) {
                console.log('Invoice not related to subscription');
                return;
            }
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: invoiceWithSubscription.subscription,
            }).populate(['userId', 'planId']);
            if (!subscription) {
                console.error(`Subscription not found: ${invoiceWithSubscription.subscription}`);
                return;
            }
            // Increment failure count
            const failureCount = subscription.paymentFailureCount + 1;
            const newStatus = failureCount >= 3 ? 'unpaid' : 'past_due';
            await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                status: newStatus,
                paymentFailureCount: failureCount,
                lastWebhookEventId: eventId,
            });
            // No user-level status updates needed on payment failure
            // Update business hasActiveSubscription
            const businessId = subscription.businessId;
            const isActive = ['active', 'trialing'].includes(newStatus);
            if (businessId) {
                await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: isActive });
            }
            // Send payment failed email
            const { emailNotificationService } = await Promise.resolve().then(() => __importStar(require('./email-notification.service')));
            await emailNotificationService.sendPaymentFailedEmail(subscription, invoice, failureCount);
            // If too many failures, consider additional actions
            if (failureCount >= 3) {
                console.warn(`Multiple payment failures for subscription: ${subscription._id}`);
                // Implement additional logic for handling repeated failures
            }
            console.log(`Payment failed for subscription: ${subscription._id} (attempt ${failureCount})`);
        }
        catch (error) {
            console.error('Error handling payment failed:', error);
            throw error;
        }
    }
    // Handle upcoming invoice (7 days before charge)
    async handleUpcomingInvoice(invoice, eventId) {
        try {
            const invoiceWithSubscription = invoice;
            if (!invoiceWithSubscription.subscription) {
                console.log('Invoice not related to subscription');
                return;
            }
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: invoiceWithSubscription.subscription,
            }).populate(['userId', 'planId']);
            if (!subscription) {
                console.error(`Subscription not found: ${invoiceWithSubscription.subscription}`);
                return;
            }
            // Update next payment date
            await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                nextPaymentDate: new Date(invoice.period_end * 1000),
                lastWebhookEventId: eventId,
            });
            // Send upcoming payment notification
            // await notificationService.sendUpcomingPaymentNotification(subscription, invoice)
            console.log(`Upcoming invoice notification sent for subscription: ${subscription._id}`);
        }
        catch (error) {
            console.error('Error handling upcoming invoice:', error);
            throw error;
        }
    }
    // Handle checkout session completed
    async handleCheckoutCompleted(session, eventId) {
        var _a, _b, _c;
        try {
            if (session.mode !== 'subscription') {
                console.log('Checkout session not for subscription');
                return;
            }
            const userId = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.userId;
            if (!userId) {
                console.error('No userId in checkout session metadata');
                return;
            }
            // Update subscription and user if it's already created
            if (session.subscription) {
                const stripeSubscription = await stripe_service_1.stripeService.getSubscription(session.subscription);
                await subscription_model_1.Subscription.findOneAndUpdate({ stripeSubscriptionId: stripeSubscription.id }, {
                    status: stripeSubscription.status,
                    lastWebhookEventId: eventId,
                });
                await user_model_1.User.findByIdAndUpdate(userId, {
                    stripeCustomerId: session.customer,
                });
                // Update business subscription flag right after successful checkout
                const businessId = ((_b = stripeSubscription.metadata) === null || _b === void 0 ? void 0 : _b.businessId) || ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.businessId);
                const isActive = ['active', 'trialing'].includes(stripeSubscription.status);
                if (businessId) {
                    await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: isActive });
                    await subscription_model_1.Subscription.findOneAndUpdate({ stripeSubscriptionId: stripeSubscription.id }, { businessId: new mongoose_1.Types.ObjectId(businessId) });
                }
            }
            console.log(`Checkout completed for user: ${userId}`);
            // You can add additional logic here like:
            // - Sending welcome emails
            // - Updating user status
            // - Triggering onboarding flows
        }
        catch (error) {
            console.error('Error handling checkout completed:', error);
            throw error;
        }
    }
    // Handle product updated
    async handleProductUpdated(stripeProduct, eventId) {
        try {
            const plan = await subscription_plan_model_1.SubscriptionPlan.findOne({
                stripeProductId: stripeProduct.id,
            });
            if (!plan) {
                console.warn(`Plan not found for Stripe product: ${stripeProduct.id}`);
                return;
            }
            // Update plan with new product information
            await subscription_plan_model_1.SubscriptionPlan.findByIdAndUpdate(plan._id, {
                name: stripeProduct.name,
                description: stripeProduct.description || plan.description,
                isActive: stripeProduct.active,
                lastWebhookEventId: eventId,
            });
            console.log(`Plan updated from Stripe product webhook: ${plan._id}`);
        }
        catch (error) {
            console.error('Error handling product updated:', error);
            throw error;
        }
    }
    // Handle product deleted
    async handleProductDeleted(stripeProduct, eventId) {
        try {
            const plan = await subscription_plan_model_1.SubscriptionPlan.findOne({
                stripeProductId: stripeProduct.id,
            });
            if (!plan) {
                console.warn(`Plan not found for deleted Stripe product: ${stripeProduct.id}`);
                return;
            }
            // Deactivate plan instead of deleting (preserve historical data)
            await subscription_plan_model_1.SubscriptionPlan.findByIdAndUpdate(plan._id, {
                isActive: false,
                lastWebhookEventId: eventId,
            });
            // Cancel all active subscriptions for this plan
            const activeSubscriptions = await subscription_model_1.Subscription.find({
                planId: plan._id,
                status: { $in: ['active', 'trialing'] },
            });
            for (const subscription of activeSubscriptions) {
                try {
                    await stripe_service_1.stripeService.cancelSubscription(subscription.stripeSubscriptionId, true);
                    console.log(`Canceled subscription due to product deletion: ${subscription._id}`);
                }
                catch (error) {
                    console.error(`Error canceling subscription ${subscription._id}:`, error);
                }
            }
            console.log(`Plan deactivated due to product deletion: ${plan._id}`);
        }
        catch (error) {
            console.error('Error handling product deleted:', error);
            throw error;
        }
    }
    // Handle price updated
    async handlePriceUpdated(stripePrice, eventId) {
        try {
            const plan = await subscription_plan_model_1.SubscriptionPlan.findOne({
                stripePriceId: stripePrice.id,
            });
            if (!plan) {
                console.warn(`Plan not found for Stripe price: ${stripePrice.id}`);
                return;
            }
            // Update plan with new price information
            const updateData = {
                lastWebhookEventId: eventId,
            };
            if (stripePrice.unit_amount) {
                updateData.price = stripePrice.unit_amount / 100; // Convert from cents
            }
            if (stripePrice.currency) {
                updateData.currency = stripePrice.currency;
            }
            if (stripePrice.recurring) {
                updateData.interval = stripePrice.recurring.interval;
                updateData.intervalCount = stripePrice.recurring.interval_count;
            }
            updateData.isActive = stripePrice.active;
            await subscription_plan_model_1.SubscriptionPlan.findByIdAndUpdate(plan._id, updateData);
            console.log(`Plan price updated from Stripe webhook: ${plan._id}`);
        }
        catch (error) {
            console.error('Error handling price updated:', error);
            throw error;
        }
    }
    // Handle price deleted
    async handlePriceDeleted(stripePrice, eventId) {
        try {
            const plan = await subscription_plan_model_1.SubscriptionPlan.findOne({
                stripePriceId: stripePrice.id,
            });
            if (!plan) {
                console.warn(`Plan not found for deleted Stripe price: ${stripePrice.id}`);
                return;
            }
            // Deactivate plan
            await subscription_plan_model_1.SubscriptionPlan.findByIdAndUpdate(plan._id, {
                isActive: false,
                lastWebhookEventId: eventId,
            });
            console.log(`Plan deactivated due to price deletion: ${plan._id}`);
        }
        catch (error) {
            console.error('Error handling price deleted:', error);
            throw error;
        }
    }
    // Handle payment method attached
    async handlePaymentMethodAttached(paymentMethod, eventId) {
        try {
            // Log payment method attachment for security monitoring
            console.log(`Payment method attached: ${paymentMethod.id} to customer: ${paymentMethod.customer}`);
            // You could add additional logic here like:
            // - Updating user payment method preferences
            // - Sending confirmation emails
            // - Security notifications for new payment methods
        }
        catch (error) {
            console.error('Error handling payment method attached:', error);
            throw error;
        }
    }
    // Handle customer updated
    async handleCustomerUpdated(stripeCustomer, eventId) {
        try {
            // Update user information if customer details changed
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeCustomerId: stripeCustomer.id,
            }).populate('userId');
            if (subscription && subscription.userId) {
                // Update user email if changed in Stripe
                if (stripeCustomer.email) {
                    await user_model_1.User.findByIdAndUpdate(subscription.userId, {
                        email: stripeCustomer.email,
                    });
                }
            }
            console.log(`Customer updated: ${stripeCustomer.id}`);
        }
        catch (error) {
            console.error('Error handling customer updated:', error);
            throw error;
        }
    }
    // Handle customer deleted
    async handleCustomerDeleted(stripeCustomer, eventId) {
        try {
            // Cancel all subscriptions for deleted customer
            const subscriptions = await subscription_model_1.Subscription.find({
                stripeCustomerId: stripeCustomer.id,
                status: { $in: ['active', 'trialing'] },
            });
            for (const subscription of subscriptions) {
                await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                    status: 'canceled',
                    endedAt: new Date(),
                    lastWebhookEventId: eventId,
                });
            }
            console.log(`Customer deleted and subscriptions canceled: ${stripeCustomer.id}`);
        }
        catch (error) {
            console.error('Error handling customer deleted:', error);
            throw error;
        }
    }
    // Handle dispute created (chargeback)
    async handleDisputeCreated(dispute, eventId) {
        try {
            console.warn(`Dispute created: ${dispute.id} for charge: ${dispute.charge}`);
            // Find subscription related to the disputed charge
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeCustomerId: dispute.charge
                    ? dispute.charge.customer
                    : null,
            }).populate(['userId', 'planId']);
            if (subscription) {
                // Suspend subscription due to dispute
                await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                    status: 'unpaid',
                    lastWebhookEventId: eventId,
                });
                // Send alert to admin
                console.error(`DISPUTE ALERT: Subscription ${subscription._id} suspended due to dispute ${dispute.id}`);
                // You could add notification logic here
                // await notificationService.sendDisputeAlert(subscription, dispute)
            }
        }
        catch (error) {
            console.error('Error handling dispute created:', error);
            throw error;
        }
    }
    // Handle invoice created
    async handleInvoiceCreated(invoice, eventId) {
        try {
            const invoiceWithSubscription = invoice;
            if (!invoiceWithSubscription.subscription)
                return;
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: invoiceWithSubscription.subscription,
            });
            if (subscription) {
                console.log(`Invoice created for subscription: ${subscription._id}`);
                // Send invoice email to customer
                const { emailNotificationService } = await Promise.resolve().then(() => __importStar(require('./email-notification.service')));
                await emailNotificationService.sendInvoiceEmail(invoice);
            }
        }
        catch (error) {
            console.error('Error handling invoice created:', error);
            throw error;
        }
    }
    // Handle invoice finalized
    async handleInvoiceFinalized(invoice, eventId) {
        try {
            const invoiceWithSubscription = invoice;
            if (!invoiceWithSubscription.subscription)
                return;
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: invoiceWithSubscription.subscription,
            });
            if (subscription) {
                await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                    nextPaymentDate: new Date(invoice.period_end * 1000),
                    lastWebhookEventId: eventId,
                });
                console.log(`Invoice finalized for subscription: ${subscription._id}`);
            }
        }
        catch (error) {
            console.error('Error handling invoice finalized:', error);
            throw error;
        }
    }
    // Handle payment intent succeeded
    async handlePaymentIntentSucceeded(paymentIntent, eventId) {
        try {
            console.log(`Payment intent succeeded: ${paymentIntent.id}`);
            // Find subscription by customer
            if (paymentIntent.customer) {
                const subscription = await subscription_model_1.Subscription.findOne({
                    stripeCustomerId: paymentIntent.customer,
                });
                if (subscription) {
                    await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                        paymentFailureCount: 0, // Reset failure count on success
                        lastWebhookEventId: eventId,
                    });
                }
            }
        }
        catch (error) {
            console.error('Error handling payment intent succeeded:', error);
            throw error;
        }
    }
    // Handle payment intent failed
    async handlePaymentIntentFailed(paymentIntent, eventId) {
        try {
            console.warn(`Payment intent failed: ${paymentIntent.id}`);
            if (paymentIntent.customer) {
                const subscription = await subscription_model_1.Subscription.findOne({
                    stripeCustomerId: paymentIntent.customer,
                });
                if (subscription) {
                    const failureCount = subscription.paymentFailureCount + 1;
                    await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                        paymentFailureCount: failureCount,
                        lastWebhookEventId: eventId,
                    });
                    // Alert on multiple failures
                    if (failureCount >= 3) {
                        console.error(`CRITICAL: Multiple payment failures for subscription ${subscription._id}`);
                    }
                }
            }
        }
        catch (error) {
            console.error('Error handling payment intent failed:', error);
            throw error;
        }
    }
    // Handle subscription paused
    async handleSubscriptionPaused(stripeSubscription, eventId) {
        var _a;
        try {
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: stripeSubscription.id,
            });
            if (subscription) {
                await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                    status: 'paused',
                    pausedAt: new Date(),
                    lastWebhookEventId: eventId,
                });
                // No user-level status updates needed on pause
                // Update business hasActiveSubscription
                const businessId = subscription.businessId || ((_a = stripeSubscription.metadata) === null || _a === void 0 ? void 0 : _a.businessId);
                if (businessId) {
                    await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: false });
                }
                console.log(`Subscription paused: ${subscription._id}`);
            }
        }
        catch (error) {
            console.error('Error handling subscription paused:', error);
            throw error;
        }
    }
    // Handle subscription resumed
    async handleSubscriptionResumed(stripeSubscription, eventId) {
        var _a;
        try {
            const subscription = await subscription_model_1.Subscription.findOne({
                stripeSubscriptionId: stripeSubscription.id,
            });
            if (subscription) {
                await subscription_model_1.Subscription.findByIdAndUpdate(subscription._id, {
                    status: stripeSubscription.status,
                    resumedAt: new Date(),
                    lastWebhookEventId: eventId,
                });
                // No user-level status updates needed on resume
                // Update business hasActiveSubscription
                const businessId = subscription.businessId || ((_a = stripeSubscription.metadata) === null || _a === void 0 ? void 0 : _a.businessId);
                const isActive = ['active', 'trialing'].includes(stripeSubscription.status);
                if (businessId) {
                    await business_model_1.Business.findByIdAndUpdate(businessId, { hasActiveSubscription: isActive });
                }
                console.log(`Subscription resumed: ${subscription._id}`);
            }
        }
        catch (error) {
            console.error('Error handling subscription resumed:', error);
            throw error;
        }
    }
    // Handle setup intent succeeded (for saving payment methods)
    async handleSetupIntentSucceeded(setupIntent, eventId) {
        try {
            console.log(`Setup intent succeeded: ${setupIntent.id}`);
            // This indicates a payment method was successfully saved
            // You could send confirmation notifications here
        }
        catch (error) {
            console.error('Error handling setup intent succeeded:', error);
            throw error;
        }
    }
    // Handle payment method automatically updated (card expiry updates)
    async handlePaymentMethodUpdated(paymentMethod, eventId) {
        try {
            console.log(`Payment method automatically updated: ${paymentMethod.id}`);
            // Stripe automatically updates expired cards
            // You could notify the customer about the update
        }
        catch (error) {
            console.error('Error handling payment method updated:', error);
            throw error;
        }
    }
    // Helper method to determine subscription tier
    getSubscriptionTier(planName) {
        const raw = typeof planName === 'string' ? planName : (planName === null || planName === void 0 ? void 0 : planName.en) || (planName === null || planName === void 0 ? void 0 : planName.es) || '';
        const name = raw.toLowerCase();
        if (name.includes('enterprise') || name.includes('pro')) {
            return 'premium';
        }
        else if (name.includes('basic') || name.includes('starter')) {
            return 'basic';
        }
        return 'free';
    }
    // Verify webhook signature
    verifyWebhookSignature(payload, signature) {
        try {
            return stripe_service_1.stripeService.constructWebhookEvent(payload, signature);
        }
        catch (error) {
            console.error('Webhook signature verification failed:', error);
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid webhook signature');
        }
    }
}
exports.webhookService = new WebhookService();
