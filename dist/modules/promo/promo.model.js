"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromoLink = void 0;
const mongoose_1 = require("mongoose");
const promoLinkSchema = new mongoose_1.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    checkoutReservationId: { type: String, default: null },
    checkoutUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    checkoutMapId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Map', default: null },
    checkoutExpiresAt: { type: Date, default: null },
    checkoutSessionId: { type: String, default: null },
    checkoutReturnOrigin: { type: String, default: null },
    mapId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Map',
        default: null,
    },
    price: {
        type: Number,
        required: true,
        min: 0,
    },
    promoType: {
        type: String,
        enum: ['influencer', 'upgrade', 'custom'],
        required: true,
        default: 'upgrade',
        index: true,
    },
    label: {
        type: String,
        required: true,
    },
    recipientEmail: {
        type: String,
        default: null,
        index: true,
    },
    isEmailSent: {
        type: Boolean,
        default: false,
        index: true,
    },
    emailSentAt: {
        type: Date,
        default: null,
    },
    isUsed: {
        type: Boolean,
        default: false,
        index: true,
    },
    usedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    usedAt: {
        type: Date,
        default: null,
    },
    expiresAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
exports.PromoLink = (0, mongoose_1.model)('PromoLink', promoLinkSchema);
