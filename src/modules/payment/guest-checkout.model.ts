import { Schema, model } from 'mongoose'

// A checkout capability is deliberately separate from login/refresh tokens.
// Keep the record for recovery/auditing; expiry is checked on every request.
const schema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  mapId: { type: Schema.Types.ObjectId, ref: 'Map', required: true },
  email: { type: String, required: true },
  sessionId: String,
  returnOrigin: String,
  expiresAt: { type: Date, required: true },
  redeemedAt: Date,
}, { timestamps: true })

export const GuestCheckout = model('GuestCheckout', schema)
