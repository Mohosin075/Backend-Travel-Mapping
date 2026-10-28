"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const bcrypt_1 = __importDefault(require("bcrypt"));
const user_1 = require("../../enum/user");
// ------------------ USER SCHEMA ------------------
const UserSchema = new mongoose_1.Schema({
    name: { type: String, trim: true },
    email: { type: String, unique: true, lowercase: true, required: true },
    profile: { type: String, default: '' },
    phone: { type: String },
    website: { type: String },
    instagram: { type: String },
    description: { type: String },
    interest: { type: [String], enum: Object.values(user_1.InterestCategory) },
    status: {
        type: String,
        enum: Object.values(user_1.USER_STATUS),
        default: user_1.USER_STATUS.ACTIVE,
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
        enum: Object.values(user_1.USER_ROLES),
        default: user_1.USER_ROLES.USER,
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
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Map',
        },
    ],
    favoritePlaces: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Place',
        },
    ],
    favoriteOffers: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Offer',
        },
    ],
    favoriteBusinesses: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Business',
        },
    ],
    visitedPlaces: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Place',
        },
    ],
    visitedPlacesCount: { type: Number, default: 0 },
    purchasedMaps: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Map',
        },
    ],
    deactivatedMaps: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Map',
        },
    ],
    // --- Points & Rewards ---
    points: { type: Number, default: 0 },
    level: { type: Number, default: 0 }, // starts at level 0: Explorador
    totalReviewsApproved: { type: Number, default: 0 },
    redeemedFreeMap: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Map', default: null },
    redeemedFreeMaps: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Map' }],
    // --- Subscription Fields ---
    stripeCustomerId: { type: String, default: null },
    subscriptionStatus: { type: String, default: 'none' },
    subscriptionTier: { type: String, default: 'free' },
    trialUsed: { type: Boolean, default: false },
    subscriptionExpiresAt: { type: Date, default: null },
    assignedMaps: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Map',
        },
    ],
    assignedCountries: { type: [String], default: [] },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
// Virtual for full profile URL
UserSchema.virtual('fullProfile').get(function () {
    if (!this.profile)
        return null;
    if (this.profile.startsWith('http'))
        return this.profile;
    return `${this.profile}`;
});
// Virtual for awards
UserSchema.virtual('awards', {
    ref: 'Award',
    localField: '_id',
    foreignField: 'userId',
});
// ------------------ INDEXES ------------------
UserSchema.index({ location: '2dsphere' }); // Geo queries support
// ------------------ PRE HOOKS ------------------
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password)
        return next();
    this.password = await bcrypt_1.default.hash(this.password, 10);
    next();
});
// ------------------ STATIC METHODS ------------------
UserSchema.statics.isPasswordMatched = async function (givenPassword, savedPassword) {
    return bcrypt_1.default.compare(givenPassword, savedPassword);
};
// ------------------ MODEL ------------------
exports.User = (0, mongoose_1.model)('User', UserSchema);
