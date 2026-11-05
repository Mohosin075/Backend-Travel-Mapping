import { Schema, model } from 'mongoose'

const UsageViewSchema = new Schema(
  {
    viewerKey: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: ['map', 'place', 'business'],
    },
    entityId: { type: String, required: true },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    lastCountedAt: { type: Date },
  },
  { timestamps: true },
)

UsageViewSchema.index({ viewerKey: 1, type: 1, entityId: 1 }, { unique: true })
UsageViewSchema.index({ type: 1, entityId: 1, lastSeenAt: -1 })

export const UsageView = model('UsageView', UsageViewSchema)
