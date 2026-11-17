"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromoValidations = exports.sendBulkEmailsZodSchema = exports.createPromoCheckoutSessionZodSchema = exports.claimPromoZodSchema = exports.bulkGeneratePromoZodSchema = void 0;
const zod_1 = require("zod");
exports.bulkGeneratePromoZodSchema = zod_1.z.object({
    body: zod_1.z.object({
        mapId: zod_1.z.string().optional().nullable(),
        price: zod_1.z.number({ required_error: 'Price is required' }).min(0),
        promoType: zod_1.z.enum(['influencer', 'upgrade', 'custom']).optional(),
        label: zod_1.z.string({ required_error: 'Label is required' }),
        emails: zod_1.z.array(zod_1.z.string().email()).optional(),
        count: zod_1.z.number().min(1).optional(),
        expiresAt: zod_1.z.string().optional().nullable(),
    }),
});
exports.claimPromoZodSchema = zod_1.z.object({
    body: zod_1.z.object({
        code: zod_1.z.string({ required_error: 'Code is required' }),
        mapId: zod_1.z.string().optional().nullable(), // If code has mapId null, user must specify mapId to claim
    }),
});
exports.createPromoCheckoutSessionZodSchema = zod_1.z.object({
    body: zod_1.z.object({
        code: zod_1.z.string({ required_error: 'Code is required' }),
        mapId: zod_1.z.string().optional().nullable(), // If code has mapId null, user must specify mapId
    }),
});
exports.sendBulkEmailsZodSchema = zod_1.z.object({
    body: zod_1.z.object({
        promoIds: zod_1.z
            .array(zod_1.z.string({ required_error: 'Promo IDs must be strings' }))
            .min(1, 'At least one promo link ID is required'),
    }),
});
exports.PromoValidations = {
    verifyPayment: zod_1.z.object({ body: zod_1.z.object({
            code: zod_1.z.string().min(1).max(100),
            sessionId: zod_1.z.string().regex(/^cs_[a-zA-Z0-9_]+$/).max(255).optional(),
        }) }),
    bulkGeneratePromoZodSchema: exports.bulkGeneratePromoZodSchema,
    claimPromoZodSchema: exports.claimPromoZodSchema,
    createPromoCheckoutSessionZodSchema: exports.createPromoCheckoutSessionZodSchema,
    sendBulkEmailsZodSchema: exports.sendBulkEmailsZodSchema,
};
