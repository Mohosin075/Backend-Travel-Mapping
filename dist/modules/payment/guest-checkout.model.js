"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuestCheckout = void 0;
const mongoose_1 = require("mongoose");
// A checkout capability is deliberately separate from login/refresh tokens.
// Keep the record for recovery/auditing; expiry is checked on every request.
const schema = new mongoose_1.Schema({
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    mapId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Map', required: true },
    email: { type: String, required: true },
    sessionId: String,
    returnOrigin: String,
    expiresAt: { type: Date, required: true },
    redeemedAt: Date,
}, { timestamps: true });
exports.GuestCheckout = (0, mongoose_1.model)('GuestCheckout', schema);
