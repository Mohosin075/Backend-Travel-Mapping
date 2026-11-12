import { Model, Types } from 'mongoose'
import { TranslatableString } from '../../interfaces/i18n.interface'

export type BusinessStatus = 'Pending' | 'Approved' | 'Rejected'
export type DaySchedule = {
  days: string
  openTime: string
  closeTime: string
}

export interface IBusiness {
  _id: Types.ObjectId
  user: Types.ObjectId // The user who submitted the business
  name: TranslatableString
  category: Types.ObjectId // Ref to Category
  description: TranslatableString
  access?: TranslatableString
  accessibility?: { features: string[]; notes?: TranslatableString }
  recommendations?: { tips?: TranslatableString }
  services?: string[]
  atmosphere?: TranslatableString
  contact: {
    phone: string
    website?: string
    instagram?: string
  }
  location: {
    address: string
    city: string
    country: string
    mapLocation: {
      type: 'Point'
      coordinates: [number, number] // [longitude, latitude]
    }
  }
  hours: {
    customHours: boolean
    // Supports both legacy array format and new object format { Monday: { open, close, closed } }
    schedule: DaySchedule[] | Record<string, { open: string; close: string; closed: boolean }> | null
  }
  media: {
    photos: string[]
    menu?: string
  }
  privateInfo: {
    ownerPhone: string
    contactEmail: string
  }
  plan?: Types.ObjectId // Reference to SubscriptionPlan
  status: BusinessStatus
  isAccuracyVerified: boolean
  adminReview?: {
    phoneVerified?: boolean
    websiteFunctional?: boolean
    locationPinVerified?: boolean
    mediaUploaded?: boolean
    internalNotes?: string
  }
  viewCount: number
  hasActiveSubscription: boolean
  rating?: number
  totalReview?: number
  createdAt: Date
  updatedAt: Date
}

export type BusinessModel = Model<IBusiness>
