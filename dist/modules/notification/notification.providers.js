"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailProvider = exports.EmailProvider = void 0;
const resend_1 = require("resend");
const http_status_codes_1 = require("http-status-codes");
const config_1 = __importDefault(require("../../config"));
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const notification_templates_1 = require("./notification.templates");
class EmailProvider {
    constructor() {
        this.resend = new resend_1.Resend(config_1.default.email.resend_api_key);
    }
    static getInstance() {
        if (!EmailProvider.instance) {
            EmailProvider.instance = new EmailProvider();
        }
        return EmailProvider.instance;
    }
    getSenderEmail() {
        const defaultFrom = 'Roadtripeado <noreply@roadtripeado.com>';
        const configuredFrom = config_1.default.email.from;
        if (!configuredFrom) {
            return defaultFrom;
        }
        if (configuredFrom.includes('@gmail.com') || !configuredFrom.includes('@')) {
            return defaultFrom;
        }
        return configuredFrom;
    }
    async verifyConnection() {
        try {
            const { error } = await this.resend.domains.list();
            if (error) {
                throw new Error(error.message);
            }
            console.log('✅ Resend email service verified');
        }
        catch (error) {
            console.error('❌ Resend email service verification failed:', error.message);
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.SERVICE_UNAVAILABLE, 'Email service is currently unavailable');
        }
    }
    async sendEmail(data) {
        try {
            const { subject, html } = notification_templates_1.EmailTemplates.getTemplate(data.template, data.data);
            const from = this.getSenderEmail();
            const recipients = Array.isArray(data.to)
                ? data.to
                : data.to.split(',').map((email) => email.trim()).filter(Boolean);
            const { data: result, error } = await this.resend.emails.send({
                from,
                to: recipients,
                subject,
                html,
                attachments: data.attachments,
            });
            if (error) {
                console.error('❌ Resend email sending failed:', error.message);
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Failed to send email: ${error.message}`);
            }
            console.log(`📧 Email sent via Resend: ${result === null || result === void 0 ? void 0 : result.id}`);
            return true;
        }
        catch (error) {
            console.error('❌ Email sending failed:', error.message);
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Failed to send email: ${error.message}`);
        }
    }
    async sendBulkEmails(emails) {
        const results = {
            success: 0,
            failed: 0,
        };
        for (const emailData of emails) {
            try {
                await this.sendEmail(emailData);
                results.success++;
            }
            catch (error) {
                console.error(`Failed to send email to: ${emailData.to}:`, error);
                results.failed++;
            }
        }
        console.log(`📧 Bulk email sending completed: ${results.success} succeeded, ${results.failed} failed`);
        return results;
    }
    async sendTemplateEmail(to, template, templateData, subjectOverride) {
        const data = {
            to,
            subject: subjectOverride || '',
            template,
            data: templateData,
        };
        return this.sendEmail(data);
    }
    async sendWelcomeEmail(to, userName) {
        return this.sendTemplateEmail(to, 'welcome', {
            userName,
            actionUrl: `${config_1.default.clientUrl}/dashboard`,
            actionText: 'Ir al Panel de Control',
        });
    }
    async sendPasswordReset(to, resetCode, userName) {
        return this.sendTemplateEmail(to, 'password-reset', {
            userName,
            resetCode,
            expiryMinutes: 30,
            actionUrl: `${config_1.default.clientUrl}/reset-password?code=${resetCode}`,
            actionText: 'Restablecer Contraseña',
        });
    }
    async sendAccountVerification(to, userName, verificationToken) {
        const verificationUrl = `${config_1.default.clientUrl}/verify-email?token=${verificationToken}`;
        return this.sendTemplateEmail(to, 'account-verification', {
            userName,
            verificationUrl,
            actionUrl: verificationUrl,
            actionText: 'Verificar Cuenta',
        });
    }
}
exports.EmailProvider = EmailProvider;
exports.emailProvider = EmailProvider.getInstance();
