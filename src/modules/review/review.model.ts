import { Schema, model } from 'mongoose'
import { IReview, ReviewModel } from './review.interface'

const reviewSchema = new Schema<IReview, ReviewModel>(
  {
    placeId: { type: Schema.Types.ObjectId, ref: 'Place' },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    reviewer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: Schema.Types.Mixed, required: true },
    media: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
    },
    isVerified: { type: Boolean, default: false },
    pointsEarned: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
)

reviewSchema.index({ placeId: 1 })
reviewSchema.index({ businessId: 1 })
reviewSchema.index({ reviewer: 1 })
reviewSchema.index({ placeId: 1, reviewer: 1 })
reviewSchema.index({ businessId: 1, reviewer: 1 })
reviewSchema.index({ status: 1 })
reviewSchema.index({ reviewer: 1, createdAt: -1 })
reviewSchema.index({ placeId: 1, createdAt: -1 })
reviewSchema.index({ businessId: 1, createdAt: -1 })

export const Review = model<IReview, ReviewModel>('Review', reviewSchema)
