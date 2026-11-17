"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageViewDay = void 0;
const mongoose_1 = require("mongoose");
// Preserve past reporting periods when the lifetime viewer's lastSeenAt changes.
// The deterministic primary key deduplicates concurrent requests without an index migration.
const schema = new mongoose_1.Schema({
    _id: { type: String, required: true },
    viewerKey: { type: String, required: true },
    type: { type: String, enum: ['map', 'place', 'business'], required: true },
    entityId: { type: String, required: true },
    lastSeenAt: { type: Date, required: true },
});
schema.index({ type: 1, entityId: 1, lastSeenAt: -1 });
schema.index({ lastSeenAt: -1 }); // Global historical activity ranges
exports.UsageViewDay = (0, mongoose_1.model)('UsageViewDay', schema);
