import { Schema, model } from 'mongoose'

// Preserve past reporting periods when the lifetime viewer's lastSeenAt changes.
// The deterministic primary key deduplicates concurrent requests without an index migration.
const schema = new Schema({
  _id: { type: String, required: true },
  viewerKey: { type: String, required: true },
  type: { type: String, enum: ['map', 'place', 'business'], required: true },
  entityId: { type: String, required: true },
  lastSeenAt: { type: Date, required: true },
})
schema.index({ type: 1, entityId: 1, lastSeenAt: -1 })

export const UsageViewDay = model('UsageViewDay', schema)
