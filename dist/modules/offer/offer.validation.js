"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOfferZodSchema = exports.createOfferZodSchema = void 0;
const zod_1 = require("zod");
const offer_1 = require("../../enum/offer");
const refineDiscount = (data, ctx) => {
    if (data.discountType === offer_1.DISCOUNT_TYPE.PERCENTAGE) {
        const val = Number(data.discountValue);
        if (isNaN(val) || val <= 0 || val > 100) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Percentage discount must be between 1 and 100',
                path: ['discountValue'],
            });
        }
    }
    else if (data.discountType === offer_1.DISCOUNT_TYPE.FLAT) {
        const val = Number(data.discountValue);
        if (isNaN(val) || val <= 0) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Flat discount must be a positive number',
                path: ['discountValue'],
            });
        }
    }
    else if (data.discountType === offer_1.DISCOUNT_TYPE.BOGO) {
        const secondType = data.bogoSecondType || offer_1.BOGO_SECOND_TYPE.FREE;
        if (secondType === offer_1.BOGO_SECOND_TYPE.PERCENTAGE) {
            const val = Number(data.discountValue);
            if (isNaN(val) || val <= 0 || val > 100) {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    message: 'BOGO second-item discount must be between 1 and 100',
                    path: ['discountValue'],
                });
            }
        }
    }
    else if (data.discountType === offer_1.DISCOUNT_TYPE.FIXED_PRICE) {
        const val = Number(data.discountValue);
        if (isNaN(val) || val <= 0) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Fixed price must be a positive number (the total bundle price)',
                path: ['discountValue'],
            });
        }
    }
};
const translatableSchema = zod_1.z.union([
    zod_1.z.string(),
    zod_1.z.object({
        en: zod_1.z.string().optional(),
        es: zod_1.z.string().optional(),
    }),
]);
exports.createOfferZodSchema = zod_1.z.object({
    body: zod_1.z
        .object({
        title: translatableSchema,
        photo: zod_1.z.string().optional(),
        images: zod_1.z.any().optional(),
        place: zod_1.z.string().optional(),
        business: zod_1.z.string().optional(),
        description: translatableSchema,
        discountType: zod_1.z.nativeEnum(offer_1.DISCOUNT_TYPE, {
            required_error: 'Discount Type is required',
        }),
        discountValue: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
        bogoSecondType: zod_1.z.nativeEnum(offer_1.BOGO_SECOND_TYPE).optional(),
        validFrom: zod_1.z.string().datetime().optional().nullable(),
        validUntil: zod_1.z.string().datetime().optional().nullable(),
        noExpiration: zod_1.z.boolean().optional(),
        maxRedemptions: zod_1.z.number().optional(),
        totalRedemptionLimit: zod_1.z.number().optional().nullable(),
        redemptionRules: zod_1.z.array(zod_1.z.string()).optional(),
        buttonLabel: translatableSchema.optional(),
        redemptionDuration: zod_1.z.number().optional(),
        redemptionFrequency: zod_1.z.enum(['daily', 'weekly', 'monthly', 'once', 'custom']).optional(),
        status: zod_1.z.nativeEnum(offer_1.OFFER_STATUS).default(offer_1.OFFER_STATUS.ACTIVE),
        redemptionsCount: zod_1.z.number().default(0),
    })
        .superRefine(refineDiscount),
});
exports.updateOfferZodSchema = zod_1.z.object({
    params: zod_1.z.object({
        id: zod_1.z.string({ required_error: 'Offer ID is required' }),
    }),
    body: zod_1.z
        .object({
        title: translatableSchema.optional(),
        photo: zod_1.z.string().optional(),
        images: zod_1.z.any().optional(),
        place: zod_1.z.string().optional(),
        business: zod_1.z.string().optional(),
        description: translatableSchema.optional(),
        discountType: zod_1.z.nativeEnum(offer_1.DISCOUNT_TYPE).optional(),
        discountValue: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
        bogoSecondType: zod_1.z.nativeEnum(offer_1.BOGO_SECOND_TYPE).optional(),
        validFrom: zod_1.z.string().datetime().optional().nullable(),
        validUntil: zod_1.z.string().datetime().optional().nullable(),
        noExpiration: zod_1.z.boolean().optional(),
        maxRedemptions: zod_1.z.number().optional(),
        totalRedemptionLimit: zod_1.z.number().optional().nullable(),
        redemptionRules: zod_1.z.array(zod_1.z.string()).optional(),
        buttonLabel: translatableSchema.optional(),
        redemptionDuration: zod_1.z.number().optional(),
        redemptionFrequency: zod_1.z.enum(['daily', 'weekly', 'monthly', 'once', 'custom']).optional(),
        status: zod_1.z.nativeEnum(offer_1.OFFER_STATUS).optional(),
        redemptionsCount: zod_1.z.number().nonnegative().optional(),
    })
        .superRefine(refineDiscount),
});
