"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeService = void 0;
const stripe_1 = __importDefault(require("stripe"));
const config_1 = __importDefault(require("../../config"));
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const http_status_codes_1 = require("http-status-codes");
class StripeService {
    constructor() {
        if (!config_1.default.stripe.stripeSecretKey) {
            throw new Error('Stripe secret key is required');
        }
        this.stripe = new stripe_1.default(config_1.default.stripe.stripeSecretKey, {
            apiVersion: '2024-04-10',
            typescript: true,
        });
    }
    // Customer Management
    async createCustomer(email, name, metadata) {
        try {
            const customer = await this.stripe.customers.create({
                email,
                name,
                metadata: metadata || {},
            });
            console.log(`Stripe customer created: ${customer.id}`);
            return customer;
        }
        catch (error) {
            console.error('Error creating Stripe customer:', error);
            throw error;
        }
    }
    async getCustomer(customerId) {
        try {
            const customer = await this.stripe.customers.retrieve(customerId);
            return customer;
        }
        catch (error) {
            console.error(`Error retrieving Stripe customer ${customerId}:`, error);
            throw error;
        }
    }
    async updateCustomer(customerId, params) {
        try {
            const customer = await this.stripe.customers.update(customerId, params);
            console.log(`Stripe customer updated: ${customerId}`);
            return customer;
        }
        catch (error) {
            console.error(`Error updating Stripe customer ${customerId}:`, error);
            throw error;
        }
    }
    // Subscription Management
    async createSubscription(params) {
        var _a;
        try {
            if ((_a = config_1.default.stripe) === null || _a === void 0 ? void 0 : _a.automaticTaxEnabled) {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Please use subscription Checkout so applicable tax can be calculated from your billing address.');
            }
            const subscriptionParams = {
                customer: params.customerId,
                items: [{ price: params.priceId }],
                metadata: params.metadata || {},
                payment_behavior: 'default_incomplete',
                payment_settings: { save_default_payment_method: 'on_subscription' },
                expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
            };
            // Add trial period if specified
            if (params.trialPeriodDays && params.trialPeriodDays > 0) {
                subscriptionParams.trial_period_days = params.trialPeriodDays;
            }
            // Add payment method if provided
            if (params.paymentMethodId) {
                subscriptionParams.default_payment_method = params.paymentMethodId;
            }
            const subscription = await this.stripe.subscriptions.create(subscriptionParams);
            console.log(`Stripe subscription created: ${subscription.id}`);
            return subscription;
        }
        catch (error) {
            console.error('Error creating Stripe subscription:', error);
            throw error;
        }
    }
    async getCheckoutSession(sessionId) {
        try {
            return await this.stripe.checkout.sessions.retrieve(sessionId);
        }
        catch (error) {
            console.error(`Error retrieving Stripe checkout session ${sessionId}:`, error);
            throw error;
        }
    }
    async getSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
                expand: ['latest_invoice.payment_intent'],
            });
            return subscription;
        }
        catch (error) {
            console.error(`Error retrieving Stripe subscription ${subscriptionId}:`, error);
            throw error;
        }
    }
    async updateSubscription(subscriptionId, params) {
        try {
            const subscription = await this.stripe.subscriptions.update(subscriptionId, params);
            console.log(`Stripe subscription updated: ${subscriptionId}`);
            return subscription;
        }
        catch (error) {
            console.error(`Error updating Stripe subscription ${subscriptionId}:`, error);
            throw error;
        }
    }
    async cancelSubscription(subscriptionId, cancelAtPeriodEnd = false) {
        try {
            let subscription;
            if (cancelAtPeriodEnd) {
                subscription = await this.stripe.subscriptions.update(subscriptionId, {
                    cancel_at_period_end: true,
                });
            }
            else {
                subscription = await this.stripe.subscriptions.cancel(subscriptionId);
            }
            console.log(`Stripe subscription canceled: ${subscriptionId}`);
            return subscription;
        }
        catch (error) {
            console.error(`Error canceling Stripe subscription ${subscriptionId}:`, error);
            throw error;
        }
    }
    async reactivateSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: false,
            });
            console.log(`Stripe subscription reactivated: ${subscriptionId}`);
            return subscription;
        }
        catch (error) {
            console.error(`Error reactivating Stripe subscription ${subscriptionId}:`, error);
            throw error;
        }
    }
    // Payment Method Management
    async attachPaymentMethod(paymentMethodId, customerId) {
        try {
            const paymentMethod = await this.stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId,
            });
            console.log(`Payment method attached: ${paymentMethodId} to customer: ${customerId}`);
            return paymentMethod;
        }
        catch (error) {
            console.error('Error attaching payment method:', error);
            throw error;
        }
    }
    async setDefaultPaymentMethod(customerId, paymentMethodId) {
        try {
            const customer = await this.stripe.customers.update(customerId, {
                invoice_settings: {
                    default_payment_method: paymentMethodId,
                },
            });
            console.log(`Default payment method set for customer: ${customerId}`);
            return customer;
        }
        catch (error) {
            console.error('Error setting default payment method:', error);
            throw error;
        }
    }
    // Checkout Session
    async createCheckoutSession(params) {
        var _a;
        try {
            const sessionParams = {
                ...(((_a = config_1.default.stripe) === null || _a === void 0 ? void 0 : _a.automaticTaxEnabled) ? {
                    automatic_tax: { enabled: true },
                    billing_address_collection: 'required',
                    customer_update: { address: 'auto' },
                } : {}),
                customer: params.customerId,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: params.priceId,
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: params.successUrl,
                cancel_url: params.cancelUrl,
                metadata: params.metadata || {},
            };
            // Add trial period and metadata to subscription
            if (params.trialPeriodDays && params.trialPeriodDays > 0) {
                sessionParams.subscription_data = {
                    trial_period_days: params.trialPeriodDays,
                    metadata: params.metadata || {}, // ← Add metadata to subscription
                };
            }
            else {
                sessionParams.subscription_data = {
                    metadata: params.metadata || {}, // ← Add metadata to subscription
                };
            }
            const session = await this.stripe.checkout.sessions.create(sessionParams);
            console.log(`Stripe checkout session created: ${session.id}`);
            return session;
        }
        catch (error) {
            console.error('Error creating Stripe checkout session:', error);
            throw error;
        }
    }
    // Invoice Management
    async getUpcomingInvoice(customerId) {
        try {
            const invoice = await this.stripe.invoices.retrieveUpcoming({
                customer: customerId,
            });
            return invoice;
        }
        catch (error) {
            console.error(`Error retrieving upcoming invoice for customer ${customerId}:`, error);
            throw error;
        }
    }
    // Webhook Verification
    constructWebhookEvent(payload, signature) {
        try {
            if (!config_1.default.stripe.webhookSecret) {
                throw new Error('Stripe webhook secret is required');
            }
            const event = this.stripe.webhooks.constructEvent(payload, signature, config_1.default.stripe.webhookSecret);
            return event;
        }
        catch (error) {
            console.error('Error constructing webhook event:', error);
            throw error;
        }
    }
    // Product and Price Management (for admin use)
    async createProduct(params) {
        try {
            const product = await this.stripe.products.create({
                name: params.name,
                description: params.description,
                metadata: params.metadata || {},
            });
            console.log(`Stripe product created: ${product.id}`);
            return product;
        }
        catch (error) {
            console.error('Error creating Stripe product:', error);
            throw error;
        }
    }
    async createPrice(params) {
        var _a;
        try {
            const price = await this.stripe.prices.create({
                ...(((_a = config_1.default.stripe) === null || _a === void 0 ? void 0 : _a.automaticTaxEnabled) ? { tax_behavior: 'exclusive' } : {}),
                product: params.productId,
                unit_amount: params.unitAmount,
                currency: params.currency,
                recurring: {
                    interval: params.interval,
                    interval_count: params.intervalCount || 1,
                },
                metadata: params.metadata || {},
            });
            console.log(`Stripe price created: ${price.id}`);
            return price;
        }
        catch (error) {
            console.error('Error creating Stripe price:', error);
            throw error;
        }
    }
    // Update product
    async updateProduct(productId, params) {
        try {
            const product = await this.stripe.products.update(productId, params);
            console.log(`Stripe product updated: ${productId}`);
            return product;
        }
        catch (error) {
            console.error(`Error updating Stripe product ${productId}:`, error);
            throw error;
        }
    }
    // Archive price (Stripe doesn't allow price deletion, only archiving)
    async archivePrice(priceId) {
        try {
            const price = await this.stripe.prices.update(priceId, { active: false });
            console.log(`Stripe price archived: ${priceId}`);
            return price;
        }
        catch (error) {
            console.error(`Error archiving Stripe price ${priceId}:`, error);
            throw error;
        }
    }
    // Retry invoice payment
    async retryInvoicePayment(invoiceId) {
        try {
            const invoice = await this.stripe.invoices.pay(invoiceId);
            console.log(`Invoice payment retried: ${invoiceId}`);
            return invoice;
        }
        catch (error) {
            console.error(`Error retrying invoice payment ${invoiceId}:`, error);
            throw error;
        }
    }
    // Pause subscription
    async pauseSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.update(subscriptionId, {
                pause_collection: {
                    behavior: 'keep_as_draft',
                },
            });
            console.log(`Stripe subscription paused: ${subscriptionId}`);
            return subscription;
        }
        catch (error) {
            console.error(`Error pausing Stripe subscription ${subscriptionId}:`, error);
            throw error;
        }
    }
    // Resume subscription
    async resumeSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.update(subscriptionId, {
                pause_collection: null,
            });
            console.log(`Stripe subscription resumed: ${subscriptionId}`);
            return subscription;
        }
        catch (error) {
            console.error(`Error resuming Stripe subscription ${subscriptionId}:`, error);
            throw error;
        }
    }
    // Get payment method
    async getPaymentMethod(paymentMethodId) {
        try {
            const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
            return paymentMethod;
        }
        catch (error) {
            console.error(`Error retrieving payment method ${paymentMethodId}:`, error);
            throw error;
        }
    }
    // List customer payment methods
    async listCustomerPaymentMethods(customerId) {
        try {
            const paymentMethods = await this.stripe.paymentMethods.list({
                customer: customerId,
                type: 'card',
            });
            return paymentMethods.data;
        }
        catch (error) {
            console.error(`Error listing payment methods for customer ${customerId}:`, error);
            throw error;
        }
    }
    // Delete customer (for GDPR compliance)
    async deleteCustomer(customerId) {
        try {
            const deletedCustomer = await this.stripe.customers.del(customerId);
            console.log(`Stripe customer deleted: ${customerId}`);
            return deletedCustomer;
        }
        catch (error) {
            console.error(`Error deleting Stripe customer ${customerId}:`, error);
            throw error;
        }
    }
    // Create setup intent (for saving payment methods without immediate charge)
    async createSetupIntent(customerId) {
        try {
            const setupIntent = await this.stripe.setupIntents.create({
                customer: customerId,
                payment_method_types: ['card'],
                usage: 'off_session',
            });
            console.log(`Setup intent created for customer: ${customerId}`);
            return setupIntent;
        }
        catch (error) {
            console.error('Error creating setup intent:', error);
            throw error;
        }
    }
    // Create customer portal session (for managing payment methods and billing)
    async createPortalSession(customerId, returnUrl) {
        try {
            const session = await this.stripe.billingPortal.sessions.create({
                customer: customerId,
                return_url: returnUrl,
            });
            console.log(`Billing portal session created for customer: ${customerId}`);
            return session;
        }
        catch (error) {
            console.error('Error creating billing portal session:', error);
            throw error;
        }
    }
    // Get subscription with expanded data
    async getSubscriptionExpanded(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
                expand: [
                    'latest_invoice',
                    'latest_invoice.payment_intent',
                    'customer',
                    'items.data.price.product',
                ],
            });
            return subscription;
        }
        catch (error) {
            console.error(`Error retrieving expanded subscription ${subscriptionId}:`, error);
            throw error;
        }
    }
}
exports.stripeService = new StripeService();
