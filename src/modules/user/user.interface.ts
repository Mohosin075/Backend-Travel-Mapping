import { Model, Types } from 'mongoose'
import { InterestCategory, USER_ROLES, USER_STATUS } from '../../enum/user'

export interface IUserFilterables {
  searchTerm?: string
  date?: Date
  role?: USER_ROLES
  name?: string
  email?: string
  status?: string
}


// ------------------ SUB-TYPES ------------------
export type IAuthentication = {
  restrictionLeftAt: Date | null
  resetPassword: boolean
  wrongLoginAttempts: number
  passwordChangedAt?: Date
  oneTimeCode: string
  latestRequestAt: Date
  expiresAt?: Date
  requestCount?: number
  authType?: 'createAccount' | 'resetPassword'
}

export type IAddress = {
  city?: string
  postalCode?: string
  country?: string
  permanentAddress?: string
  presentAddress?: string
}

export type Point = {
  type: 'Point'
  coordinates: [number, number] // [longitude, latitude]
  address?: string[]
}

// ------------------ USER TYPE ------------------
export interface IUser {
  lastActiveAt?: Date
  _id: Types.ObjectId
  name?: string
  email?: string
  profile?: string
  phone?: string
  website?: string
  instagram?: string
  description?: string
  interest?: InterestCategory[]

  dateOfBirth?: Date
  dietaryRestrictions?: string[] // ['Vegan', 'Vegetarian', etc.]

  status: USER_STATUS // standardize statuses
  verified: boolean
  address?: IAddress
  location: Point
  password: string
  role: USER_ROLES
  appId?: string
  provider?: string
  deviceToken?: string
  timezone: string
  subscribe: boolean
  isOnboardingComplete: boolean
  // membership: Membership
  settings?: {
    pushNotification?: boolean
    emailNotification?: boolean
    locationService?: boolean
    weeklyReports?: boolean
    profileStatus: 'public' | 'private'
  }

  authentication: IAuthentication
  favoriteMaps?: Types.ObjectId[]
  favoritePlaces?: Types.ObjectId[]
  favoriteOffers?: Types.ObjectId[]
  favoriteBusinesses?: Types.ObjectId[]
  visitedPlaces?: Types.ObjectId[]
  visitedPlacesCount?: number
  purchasedMaps?: Types.ObjectId[] // Ref Map
  deactivatedMaps?: Types.ObjectId[] // Ref Map (deactivated or refunded access)
  awards?: any[]

  // --- Points & Rewards ---
  points: number
  level: number
  totalReviewsApproved: number
  redeemedFreeMap?: Types.ObjectId // The map user chose as a prize
  redeemedFreeMaps?: Types.ObjectId[] // Array of all free maps user has redeemed

  // --- Subscription Fields ---
  stripeCustomerId?: string
  subscriptionStatus?: string
  subscriptionTier?: string
  trialUsed?: boolean
  subscriptionExpiresAt?: Date

  assignedMaps?: Types.ObjectId[]
  assignedCountries?: string[]

  createdAt: Date
  updatedAt: Date
}

// ------------------ MODEL ------------------
export type UserModel = Model<IUser> & {
  isPasswordMatched(
    givenPassword: string,
    savedPassword: string,
  ): Promise<boolean>
}
