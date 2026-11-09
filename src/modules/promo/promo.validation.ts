import { z } from 'zod'

export const bulkGeneratePromoZodSchema = z.object({
  body: z.object({
    mapId: z.string().optional().nullable(),
    price: z.number({ required_error: 'Price is required' }).min(0),
    promoType: z.enum(['influencer', 'upgrade', 'custom']).optional(),
    label: z.string({ required_error: 'Label is required' }),
    emails: z.array(z.string().email()).optional(),
    count: z.number().min(1).optional(),
    expiresAt: z.string().optional().nullable(),
  }),
})

export const claimPromoZodSchema = z.object({
  body: z.object({
    code: z.string({ required_error: 'Code is required' }),
    mapId: z.string().optional().nullable(), // If code has mapId null, user must specify mapId to claim
  }),
})

export const createPromoCheckoutSessionZodSchema = z.object({
  body: z.object({
    code: z.string({ required_error: 'Code is required' }),
    mapId: z.string().optional().nullable(), // If code has mapId null, user must specify mapId
  }),
})

export const sendBulkEmailsZodSchema = z.object({
  body: z.object({
    promoIds: z
      .array(z.string({ required_error: 'Promo IDs must be strings' }))
      .min(1, 'At least one promo link ID is required'),
  }),
})

export const PromoValidations = {
  verifyPayment: z.object({ body: z.object({
    code: z.string().min(1).max(100),
    sessionId: z.string().regex(/^cs_[a-zA-Z0-9_]+$/).max(255).optional(),
  }) }),
  bulkGeneratePromoZodSchema,
  claimPromoZodSchema,
  createPromoCheckoutSessionZodSchema,
  sendBulkEmailsZodSchema,
}
