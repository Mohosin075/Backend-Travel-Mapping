"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailNotificationService = void 0;
const emailHelper_1 = require("../../helpers/emailHelper");
const emailTemplate_1 = require("../../shared/emailTemplate");
const user_model_1 = require("../user/user.model");
const subscription_plan_model_1 = require("./subscription-plan.model");
const localize_1 = require("../../helpers/localize");
const toText = (val) => (0, localize_1.localizeField)(val, 'es');
const toFeatures = (list) => (Array.isArray(list) ? list.map((item) => (0, localize_1.localizeField)(item, 'es')) : []);
class EmailNotificationService {
    // Send welcome email when subscription is created
    async sendSubscriptionWelcomeEmail(subscription, plan, isTrialing = false) {
        try {
            const user = await user_model_1.User.findById(subscription.userId).select('+email');
            if (!user || !user.email) {
                console.warn(`No email found for user: ${subscription.userId}`);
                return;
            }
            const emailData = emailTemplate_1.emailTemplate.subscriptionWelcome({
                name: user.name || 'Valued Customer',
                email: user.email,
                planName: toText(plan.name),
                planPrice: plan.price,
                planInterval: plan.interval,
                isTrialing,
                trialDays: plan.trialPeriodDays,
                trialEndDate: subscription.trialEnd || undefined,
                features: toFeatures(plan.features),
                dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
            });
            await emailHelper_1.emailHelper.sendEmail(emailData);
        }
        catch (error) {
            console.error('Error sending subscription welcome email:', error);
        }
    }
    // Send trial ending reminder
    async sendTrialEndingEmail(subscription, plan, daysLeft) {
        try {
            const user = await user_model_1.User.findById(subscription.userId).select('+email');
            if (!user || !user.email)
                return;
            const emailData = emailTemplate_1.emailTemplate.trialEnding({
                name: user.name || 'Valued Customer',
                email: user.email,
                planName: toText(plan.name),
                daysLeft,
                trialEndDate: subscription.trialEnd,
                planPrice: plan.price,
                planInterval: plan.interval,
                upgradeUrl: `${process.env.FRONTEND_URL}/subscription/plans`,
            });
            await emailHelper_1.emailHelper.sendEmail(emailData);
        }
        catch (error) {
            console.error('Error sending trial ending email:', error);
        }
    }
    // Send payment success email
    async sendPaymentSuccessEmail(subscription, invoice) {
        try {
            const user = await user_model_1.User.findById(subscription.userId).select('+email');
            if (!user || !user.email)
                return;
            const emailData = emailTemplate_1.emailTemplate.paymentSuccess({
                name: user.name || 'Valued Customer',
                email: user.email,
                invoiceNumber: invoice.number || 'N/A',
                amount: (invoice.amount_paid / 100).toFixed(2),
                currency: invoice.currency.toUpperCase(),
                paymentDate: new Date(invoice.status_transitions.paid_at * 1000),
                nextPaymentDate: new Date(invoice.period_end * 1000),
                invoiceUrl: invoice.hosted_invoice_url || undefined,
                dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
            });
            await emailHelper_1.emailHelper.sendEmail(emailData);
        }
        catch (error) {
            console.error('Error sending payment success email:', error);
        }
    }
    // Send payment failed email
    async sendPaymentFailedEmail(subscription, invoice, attemptCount) {
        var _a;
        try {
            const user = await user_model_1.User.findById(subscription.userId).select('+email');
            if (!user || !user.email)
                return;
            // Try to get plan name
            const plan = await subscription_plan_model_1.SubscriptionPlan.findById(subscription.planId);
            const planName = plan ? toText(plan.name) : 'Your Plan';
            const emailData = emailTemplate_1.emailTemplate.paymentFailed({
                name: user.name || 'Valued Customer',
                email: user.email,
                planName,
                amount: (invoice.amount_due / 100).toFixed(2),
                currency: invoice.currency.toUpperCase(),
                failureReason: ((_a = invoice.last_payment_error) === null || _a === void 0 ? void 0 : _a.message) ||
                    'Payment method declined',
                retryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
                updatePaymentUrl: `${process.env.FRONTEND_URL}/billing`,
                dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
            });
            await emailHelper_1.emailHelper.sendEmail(emailData);
        }
        catch (error) {
            console.error('Error sending payment failed email:', error);
        }
    }
    // Send subscription canceled email
    async sendSubscriptionCanceledEmail(subscription, plan, canceledAt) {
        try {
            const user = await user_model_1.User.findById(subscription.userId).select('+email');
            if (!user || !user.email)
                return;
            const emailData = emailTemplate_1.emailTemplate.subscriptionCanceled({
                name: user.name || 'Valued Customer',
                email: user.email,
                planName: toText(plan.name),
                canceledAt,
                accessUntil: subscription.currentPeriodEnd,
                feedbackUrl: `${process.env.FRONTEND_URL}/feedback`,
                reactivateUrl: `${process.env.FRONTEND_URL}/subscription/plans`,
            });
            await emailHelper_1.emailHelper.sendEmail(emailData);
        }
        catch (error) {
            console.error('Error sending subscription canceled email:', error);
        }
    }
    // Send plan change notification email
    async sendPlanChangeEmail(subscription, newPlan, oldPrice) {
        try {
            const user = await user_model_1.User.findById(subscription.userId).select('+email');
            if (!user || !user.email)
                return;
            const isUpgrade = newPlan.price > oldPrice.unit_amount / 100;
            const priceDifference = Math.abs(newPlan.price - oldPrice.unit_amount / 100);
            const emailData = emailTemplate_1.emailTemplate.planChange({
                name: user.name || 'Valued Customer',
                email: user.email,
                newPlanName: toText(newPlan.name),
                newPlanPrice: newPlan.price,
                planInterval: newPlan.interval,
                isUpgrade,
                priceDifference,
                prorationNote: isUpgrade
                    ? `You've been charged $${priceDifference.toFixed(2)} for the remaining billing period.`
                    : `You'll receive a $${priceDifference.toFixed(2)} credit on your next invoice.`,
                features: toFeatures(newPlan.features),
                dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
                billingUrl: `${process.env.FRONTEND_URL}/billing`,
            });
            await emailHelper_1.emailHelper.sendEmail(emailData);
        }
        catch (error) {
            console.error('Error sending plan change email:', error);
        }
    }
    // Send invoice email (for all charges)
    async sendInvoiceEmail(invoice) {
        try {
            if (!invoice.customer_email) {
                console.warn(`No customer email for invoice: ${invoice.id}`);
                return;
            }
            // For now, we'll use the payment success template for invoices
            // You can create a separate invoice template if needed
            const emailData = emailTemplate_1.emailTemplate.paymentSuccess({
                name: 'Valued Customer',
                email: invoice.customer_email,
                invoiceNumber: invoice.number || 'N/A',
                amount: (invoice.amount_due / 100).toFixed(2),
                currency: invoice.currency.toUpperCase(),
                paymentDate: new Date(invoice.created * 1000),
                nextPaymentDate: new Date(invoice.due_date * 1000),
                invoiceUrl: invoice.hosted_invoice_url || undefined,
                dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
            });
            await emailHelper_1.emailHelper.sendEmail(emailData);
        }
        catch (error) {
            console.error('Error sending invoice email:', error);
        }
    }
}
exports.emailNotificationService = new EmailNotificationService();
