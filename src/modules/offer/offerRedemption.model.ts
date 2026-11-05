import { Schema, model } from 'mongoose'
import { IOfferRedemption, OfferRedemptionModel } from './offerRedemption.interface'

const OfferRedemptionSchema = new Schema<IOfferRedemption, OfferRedemptionModel>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    offer: { type: Schema.Types.ObjectId, ref: 'Offer', required: true },
    redemptionTime: { type: Date, default: Date.now },
    expiresAt: { type: Date }, // Optional expiry for a redemption session
  },
  {
    timestamps: true,
  }
)

// Index for performance and checking duplicate redemptions if needed
OfferRedemptionSchema.index({ user: 1, offer: 1 })
OfferRedemptionSchema.index({ offer: 1, redemptionTime: -1 })
OfferRedemptionSchema.index({ redemptionTime: -1 })

export const OfferRedemption = model<IOfferRedemption, OfferRedemptionModel>(
  'OfferRedemption',
  OfferRedemptionSchema
)
