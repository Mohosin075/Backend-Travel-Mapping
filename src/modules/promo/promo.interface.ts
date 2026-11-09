import { Model, Types } from 'mongoose'

export interface IPromoLink {
  code: string
  mapId?: Types.ObjectId | null // Optional (null allows user to choose map on claim)
  price: number // E.g., 0 for free/influencer, 5 for upgrade
  promoType: 'influencer' | 'upgrade' | 'custom'
  label: string // E.g., "Influencer - Sarah", "Old Customer Bulk Batch 1"
  recipientEmail?: string | null
  isEmailSent?: boolean
  emailSentAt?: Date | null
  isUsed: boolean
  usedBy?: Types.ObjectId | null
  usedAt?: Date | null
  expiresAt?: Date | null
  checkoutReservationId?: string | null
  checkoutUserId?: Types.ObjectId | null
  checkoutMapId?: Types.ObjectId | null
  checkoutExpiresAt?: Date | null
  checkoutSessionId?: string | null
  checkoutReturnOrigin?: string | null
}

export type PromoLinkModel = Model<IPromoLink, Record<string, never>>
