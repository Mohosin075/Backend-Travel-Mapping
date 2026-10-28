import { Schema, model } from 'mongoose'
import bcrypt from 'bcrypt'
import { IUser, UserModel } from './user.interface'
import { InterestCategory, USER_ROLES, USER_STATUS } from '../../enum/user'

// ------------------ USER SCHEMA ------------------
const UserSchema = new Schema<IUser, UserModel>(
  {
    name: { type: String, trim: true },
    email: { type: String, unique: true, lowercase: true, required: true },
    profile: { type: String, default: '' },
    phone: { type: String },
    website: { type: String },
    instagram: { type: String },
    description: { type: String },
    interest: { type: [String], enum: Object.values(InterestCategory) },

    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.ACTIVE,
    },
    verified: { type: Boolean, default: false },

    address: {
      city: String,
      postalCode: String,
      country: String,
      permanentAddress: String,
      presentAddress: String,
    },

    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0], // [longitude, latitude]
      },
    },
    subscribe: { type: Boolean, default: false },

    password: { type: String, minlength: 6 },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
    },
    appId: { type: String },
    provider: { type: String },
    deviceToken: { type: String },
    timezone: { type: String, default: 'UTC' },
    isOnboardingComplete: { type: Boolean, default: false },

    dateOfBirth: { type: Date },
    dietaryRestrictions: { type: [String], default: [] },

    settings: {
      pushNotification: { type: Boolean, default: true },
      emailNotification: { type: Boolean, default: true },
      locationService: { type: Boolean, default: true },
      weeklyReports: { type: Boolean, default: true },
      profileStatus: { type: String, default: 'public' },
    },

    authentication: {
      restrictionLeftAt: { type: Date, default: null },
      resetPassword: { type: Boolean, default: false },
      wrongLoginAttempts: { type: Number, default: 0 },
      passwordChangedAt: { type: Date },
      oneTimeCode: { type: String },
      latestRequestAt: { type: Date, default: Date.now },
      expiresAt: { type: Date },
      requestCount: { type: Number, default: 0 },
      authType: { type: String, enum: ['createAccount', 'resetPassword'] },
    },
    favoriteMaps: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Map',
      },
    ],
    favoritePlaces: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Place',
      },
    ],
    favoriteOffers: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Offer',
      },
    ],
    favoriteBusinesses: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Business',
      },
    ],
    visitedPlaces: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Place',
      },
    ],
    visitedPlacesCount: { type: Number, default: 0 },
    purchasedMaps: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Map',
      },
    ],
    deactivatedMaps: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Map',
      },
    ],
    // --- Points & Rewards ---
    points: { type: Number, default: 0 },
    level: { type: Number, default: 0 }, // starts at level 0: Explorador
    totalReviewsApproved: { type: Number, default: 0 },
    redeemedFreeMap: { type: Schema.Types.ObjectId, ref: 'Map', default: null },
    redeemedFreeMaps: [{ type: Schema.Types.ObjectId, ref: 'Map' }],

    // --- Subscription Fields ---
    stripeCustomerId: { type: String, default: null },
    subscriptionStatus: { type: String, default: 'none' },
    subscriptionTier: { type: String, default: 'free' },
    trialUsed: { type: Boolean, default: false },
    subscriptionExpiresAt: { type: Date, default: null },

    assignedMaps: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Map',
      },
    ],
    assignedCountries: { type: [String], default: [] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// Virtual for full profile URL
UserSchema.virtual('fullProfile').get(function () {
  if (!this.profile) return null
  if (this.profile.startsWith('http')) return this.profile
  return `${this.profile}`
})

// Virtual for awards
UserSchema.virtual('awards', {
  ref: 'Award',
  localField: '_id',
  foreignField: 'userId',
})

// ------------------ INDEXES ------------------
UserSchema.index({ location: '2dsphere' }) // Geo queries support

// ------------------ PRE HOOKS ------------------
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next()
  this.password = await bcrypt.hash(this.password, 10)
  next()
})

// ------------------ STATIC METHODS ------------------
UserSchema.statics.isPasswordMatched = async function (
  givenPassword: string,
  savedPassword: string,
): Promise<boolean> {
  return bcrypt.compare(givenPassword, savedPassword)
}

// ------------------ MODEL ------------------
export const User = model<IUser, UserModel>('User', UserSchema)
