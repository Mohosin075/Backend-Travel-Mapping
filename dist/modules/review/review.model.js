"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Review = void 0;
const mongoose_1 = require("mongoose");
const reviewSchema = new mongoose_1.Schema({
    placeId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Place' },
    businessId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Business' },
    reviewer: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: mongoose_1.Schema.Types.Mixed, required: true },
    media: { type: [String], default: [] },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending',
    },
    isVerified: { type: Boolean, default: false },
    pointsEarned: { type: Number, default: 0 },
}, {
    timestamps: true,
});
reviewSchema.index({ placeId: 1 });
reviewSchema.index({ businessId: 1 });
reviewSchema.index({ reviewer: 1 });
reviewSchema.index({ placeId: 1, reviewer: 1 });
reviewSchema.index({ businessId: 1, reviewer: 1 });
reviewSchema.index({ status: 1 });
reviewSchema.index({ reviewer: 1, createdAt: -1 });
reviewSchema.index({ placeId: 1, createdAt: -1 });
reviewSchema.index({ businessId: 1, createdAt: -1 });
exports.Review = (0, mongoose_1.model)('Review', reviewSchema);
