"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfferRedemption = void 0;
const mongoose_1 = require("mongoose");
const OfferRedemptionSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    offer: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Offer', required: true },
    redemptionTime: { type: Date, default: Date.now },
    expiresAt: { type: Date }, // Optional expiry for a redemption session
}, {
    timestamps: true,
});
// Index for performance and checking duplicate redemptions if needed
OfferRedemptionSchema.index({ user: 1, offer: 1 });
OfferRedemptionSchema.index({ offer: 1, redemptionTime: -1 });
OfferRedemptionSchema.index({ redemptionTime: -1 });
exports.OfferRedemption = (0, mongoose_1.model)('OfferRedemption', OfferRedemptionSchema);
