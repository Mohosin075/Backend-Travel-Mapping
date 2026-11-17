"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Map = void 0;
const mongoose_1 = require("mongoose");
const MapSchema = new mongoose_1.Schema({
    name: { type: mongoose_1.Schema.Types.Mixed, required: true },
    description: { type: mongoose_1.Schema.Types.Mixed, required: true },
    price: { type: Number, required: true, default: 0 },
    images: [{ type: String, required: true }],
    features: [{ type: String, default: [] }],
    places: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Place' }],
    country: { type: String },
    status: {
        type: String,
        enum: ['Draft', 'Published'],
        default: 'Draft',
    },
    isPaid: { type: Boolean, default: false },
    rating: { type: Number, default: 0 },
    totalReview: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
MapSchema.index({ status: 1 }); // status filter
MapSchema.index({ isPaid: 1 }); // free vs paid filter
MapSchema.index({ status: 1, isActive: 1 }); // active published maps
MapSchema.index({ status: 1, isActive: 1, createdAt: -1 }); // Published catalog order
exports.Map = (0, mongoose_1.model)('Map', MapSchema);
