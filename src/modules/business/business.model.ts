import { Schema, model } from 'mongoose'
import { IBusiness, BusinessModel } from './business.interface'

const BusinessSchema = new Schema<IBusiness, BusinessModel>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: Schema.Types.Mixed,
      required: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    description: {
      type: Schema.Types.Mixed,
      required: true,
    },
    access: { type: Schema.Types.Mixed },
    accessibility: {
      features: { type: [String], default: [] },
      notes: { type: Schema.Types.Mixed },
    },
    recommendations: { tips: { type: Schema.Types.Mixed } },
    services: { type: [String], default: [] },
    atmosphere: { type: Schema.Types.Mixed },
    contact: {
      phone: { type: String, required: true },
      website: { type: String },
      instagram: { type: String },
    },
    location: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      country: { type: String, required: true },
      mapLocation: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
          required: true,
        },
        coordinates: {
          type: [Number],
          required: true, // [longitude, latitude]
        },
      },
    },
    hours: {
      customHours: { type: Boolean, default: false },
      // Mixed to support both legacy array format and new object format { Monday: { open, close, closed } }
      schedule: { type: Schema.Types.Mixed, default: null },
    },
    media: {
      photos: { type: [String], default: [] },
      menu: { type: String },
    },
    privateInfo: {
      ownerPhone: { type: String, required: true },
      contactEmail: { type: String, required: true },
    },
    plan: {
      type: Schema.Types.ObjectId,
      ref: 'SubscriptionPlan',
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
    },
    isAccuracyVerified: {
      type: Boolean,
      default: false,
    },
    adminReview: {
      phoneVerified: { type: Boolean, default: false },
      websiteFunctional: { type: Boolean, default: false },
      locationPinVerified: { type: Boolean, default: false },
      mediaUploaded: { type: Boolean, default: false },
      internalNotes: { type: String, default: '' },
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    hasActiveSubscription: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
    },
    totalReview: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// Index for geo queries
BusinessSchema.index({ 'location.mapLocation': '2dsphere' })
// Discovery / map listing filters
BusinessSchema.index({ status: 1, hasActiveSubscription: 1 })
BusinessSchema.index({ 'location.country': 1, status: 1, hasActiveSubscription: 1 })

export const Business = model<IBusiness, BusinessModel>('Business', BusinessSchema)
