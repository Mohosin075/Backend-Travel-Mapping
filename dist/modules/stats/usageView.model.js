"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageView = void 0;
const mongoose_1 = require("mongoose");
const UsageViewSchema = new mongoose_1.Schema({
    viewerKey: { type: String, required: true },
    type: {
        type: String,
        required: true,
        enum: ['map', 'place', 'business'],
    },
    entityId: { type: String, required: true },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    lastCountedAt: { type: Date },
}, { timestamps: true });
UsageViewSchema.index({ viewerKey: 1, type: 1, entityId: 1 }, { unique: true });
UsageViewSchema.index({ type: 1, entityId: 1, lastSeenAt: -1 });
UsageViewSchema.index({ lastSeenAt: -1 }); // Global activity ranges
exports.UsageView = (0, mongoose_1.model)('UsageView', UsageViewSchema);
