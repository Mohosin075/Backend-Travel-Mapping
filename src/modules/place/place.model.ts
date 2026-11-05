import { Schema, model } from 'mongoose'
import { IPlace, PlaceModel } from './place.interface'
import { placeDifficulty } from './place.constants'

const PlaceSchema = new Schema<IPlace, PlaceModel>(
  {
    name: { type: Schema.Types.Mixed, required: true },
    map: { type: Schema.Types.ObjectId, ref: 'Map', required: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    type: {
      type: String,
      enum: ['Business', 'Regular'],
      default: 'Regular',
    },
    country: { type: String, required: true },
    description: { type: Schema.Types.Mixed, required: true },
    media: { type: [String], default: [] },
    menuImages: { type: [String], default: [] },
    address: { type: String, required: true },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    access: { type: Schema.Types.Mixed },
    accessibility: {
      features: { type: [String], default: [] },
      notes: { type: Schema.Types.Mixed },
    },
    recommendations: {
      tips: { type: Schema.Types.Mixed },
    },
    services: { type: [String], default: [] },
    schedules: { type: String },
    operatingHours: { type: Schema.Types.Mixed, default: null },
    phone: { type: String, default: "" },
    website: { type: String, default: "" },
    instagram: { type: String, default: "" },
    entryCost: { type: Schema.Types.Mixed },
    difficulty: { type: Schema.Types.Mixed },
    hikeTime: { type: Schema.Types.Mixed },
    atmosphere: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ['Draft', 'Published', 'Pending', 'Rejected'],
      default: 'Draft',
    },
    discoveredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    discoveredByName: {
      type: String,
      default: null,
    },
    adminFeedback: {
      type: String,
      default: '',
    },
    pointsAwarded: {
      type: Number,
      default: 0,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    rating: { type: Number, default: 0 },
    totalReview: { type: Number, default: 0 },
    openCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

PlaceSchema.index({ location: '2dsphere' }) // important for geo queries!
PlaceSchema.index({ map: 1, status: 1 })    // most common filter: map + status
PlaceSchema.index({ map: 1, status: 1, createdAt: -1 }) // Map list with default sort
PlaceSchema.index({ category: 1 })          // category filter
PlaceSchema.index({ status: 1 })            // status filter alone
PlaceSchema.index({ country: 1 })           // country filter
PlaceSchema.index({ createdAt: -1 })        // default sort
PlaceSchema.index({ status: 1, createdAt: -1 })
PlaceSchema.index({ type: 1, status: 1 })
PlaceSchema.index({ discoveredBy: 1 })
PlaceSchema.index(                           // text search on searchable fields
  { name: 'text', description: 'text', address: 'text', country: 'text' },
  { weights: { name: 10, address: 5, description: 2, country: 1 } }
)

export const Place = model<IPlace, PlaceModel>('Place', PlaceSchema)
