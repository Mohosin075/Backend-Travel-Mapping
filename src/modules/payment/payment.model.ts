import { Schema, model } from 'mongoose'
import { IPayment, PaymentModel } from './payment.interface'

const paymentSchema = new Schema<IPayment, PaymentModel>(
  {

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    guestCheckoutKey: { type: String },
    promoCheckoutKey: { type: String },
    mapId: {
      type: Schema.Types.ObjectId,
      ref: 'Map',
    },
    userEmail: {
      type: String,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    paymentMethod: {
      type: String,
      enum: ['stripe'],
      required: true,
      default: 'stripe',
    },
    paymentIntentId: {
      type: String,
      required: true,
      // This now stores the CHECKOUT SESSION ID, not payment intent ID
    },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'refunded'],
      default: 'pending',
    },
    refundAmount: {
      type: Number,
      min: 0,
    },
    refundReason: {
      type: String,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

paymentSchema.index({ userId: 1 });
paymentSchema.index({ guestCheckoutKey: 1 }, { unique: true, sparse: true });
paymentSchema.index({ promoCheckoutKey: 1 }, { unique: true, sparse: true });
paymentSchema.index({ paymentIntentId: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ mapId: 1, status: 1, createdAt: -1 });

export const Payment = model<IPayment, PaymentModel>('Payment', paymentSchema)
