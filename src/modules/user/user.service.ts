import { StatusCodes } from 'http-status-codes'
import ApiError from '../../errors/ApiError'
import { IUser, IUserFilterables } from './user.interface'
import { User } from './user.model'
import { Types } from 'mongoose'

import { InterestCategory, USER_ROLES, USER_STATUS } from '../../enum/user'

import { JwtPayload } from 'jsonwebtoken'
import { paginationHelper } from '../../helpers/paginationHelper'
import { IPaginationOptions } from '../../interfaces/pagination'
import { S3Helper } from '../../helpers/image/s3helper'
import config from '../../config'
import { userFilterableFields } from './user.constants'
import { generateOtp } from '../../utils/crypto'
import { Review } from '../review/review.model'
import { emailTemplate } from '../../shared/emailTemplate'
import { emailHelper } from '../../helpers/emailHelper'
import { calculateUserLevel, USER_LEVELS } from '../../constants/userLevels.constant'
import { NotificationIntegration } from '../notification/notification.integration'
import { OfferRedemption } from '../offer/offerRedemption.model'
import { Award } from '../award/award.model'
import '../award/awardConfig.model'
import { LevelConfigServices } from '../award/levelConfig.service'
import { Visited } from '../visited/visited.model'
import { Map } from '../map/map.model'
import { Place } from '../place/place.model'
import '../business/business.model'
import '../offer/offer.model'
import { localizeField } from '../../helpers/localize'

const updateProfile = async (user: JwtPayload, payload: Partial<IUser>) => {
  const isUserExist = await User.findOne({
    _id: user.authId,
    status: { $nin: [USER_STATUS.DELETED] },
  })

  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  const updateData: any = { ...payload }
  if (updateData.profileStatus !== undefined) {
    updateData['settings.profileStatus'] = updateData.profileStatus
    delete updateData.profileStatus
  }
  if (updateData.city !== undefined) {
    updateData['address.city'] = updateData.city
    delete updateData.city
  }

  const updatedProfile = await User.findOneAndUpdate(
    { _id: user.authId, status: { $nin: [USER_STATUS.DELETED] } },
    {
      $set: updateData,
    },
    { new: true },
  )

  if (!updatedProfile) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update profile.')
  }

  return 'Profile updated successfully.'
}

const createAdmin = async (): Promise<Partial<IUser> | null> => {
  const admin = {
    email: config.super_admin.email,
    name: config.super_admin.name,
    password: config.super_admin.password,
    role: USER_ROLES.SUPER_ADMIN,
    status: USER_STATUS.ACTIVE,
    verified: true,
    authentication: {
      oneTimeCode: null,
      restrictionLeftAt: null,
      expiresAt: null,
      latestRequestAt: new Date(),
      authType: 'createAccount',
    },
  }

  const isAdminExist = await User.findOne({
    email: admin.email,
    status: { $nin: [USER_STATUS.DELETED] },
  })

  if (isAdminExist) {
    console.log('Admin account already exist, skipping creation.🦥')
    return isAdminExist
  }
  const result = await User.create([admin])
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create admin')
  }
  return result[0]
}

const getAllUsers = async (
  paginationOptions: IPaginationOptions,
  filterables: IUserFilterables = {},
) => {
  const { searchTerm, ...filterData } = filterables
  const { page, skip, limit, sortBy, sortOrder } =
    paginationHelper.calculatePagination(paginationOptions)

  let whereConditions: any = {}

  // 🔥 FIXED: Properly typed arrays
  const searchConditions: any[] = []
  const filterConditions: any[] = []

  // Search functionality
  if (searchTerm && searchTerm.trim() !== '') {
    searchConditions.push({
      $or: userFilterableFields.map(field => ({
        [field]: {
          $regex: searchTerm.trim(),
          $options: 'i',
        },
      })),
    })
  }

  // Filter functionality
  if (Object.keys(filterData).length > 0) {
    Object.entries(filterData).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        if (key !== 'status') {
          filterConditions.push({ [key]: value })
        }
      }
    })
  }

  // Handle status filtering (allows retrieving deleted users if explicitly requested)
  if (filterData.status) {
    filterConditions.push({ status: filterData.status })
  } else {
    // Default: Exclude deleted and null status users if no status is specified
    filterConditions.push({
      status: { $nin: [USER_STATUS.DELETED, null] },
    })
  }

  // Combine conditions
  if (searchConditions.length > 0 && filterConditions.length > 0) {
    whereConditions = {
      $and: [...searchConditions, ...filterConditions],
    }
  } else if (searchConditions.length > 0) {
    whereConditions = { $and: searchConditions }
  } else if (filterConditions.length > 0) {
    whereConditions = { $and: filterConditions }
  }

  const [users, total] = await Promise.all([
    User.find(whereConditions)
      .skip(skip)
      .limit(limit)
      .sort(sortBy ? { [sortBy]: sortOrder } : { createdAt: -1 })
      .select('-password -authentication -__v')
      .lean(),
    User.countDocuments(whereConditions),
  ])

  const levelConfigs = await LevelConfigServices.getAllLevelConfigs()
  const result = users.map(user => {
    const pts = (user as any).points || 0
    const revs = (user as any).totalReviewsApproved || 0
    const levelInfo = LevelConfigServices.calculateDynamicLevelFromList(
      pts,
      revs,
      levelConfigs
    )
    return {
      ...user,
      level: levelInfo.levelNumber,
      levelInfo,
    }
  })

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      totalPage: Math.ceil(total / limit),
    },
    data: result,
  }
}

const deleteUser = async (
  userId: string,
  actor?: JwtPayload,
): Promise<string> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const isUserExist = await User.findOne({
    _id: userId,
    status: { $nin: [USER_STATUS.DELETED] },
  })
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  assertCanDeleteUser(actor?.role, isUserExist.role)

  const deletedUser = await User.findOneAndUpdate(
    { _id: userId, status: { $nin: [USER_STATUS.DELETED] } },
    { $set: { status: USER_STATUS.DELETED } },
    { new: true },
  )

  if (!deletedUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to delete user.')
  }

  return 'User deleted successfully.'
}

const deleteProfile = async (
  userId: string,
  password: string,
): Promise<string> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const isUserExist = await User.findOne({
    _id: userId,
    status: { $nin: [USER_STATUS.DELETED] },
  }).select('+password')
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }
  const isPasswordMatched = await User.isPasswordMatched(
    password,
    isUserExist.password,
  )

  if (!isPasswordMatched) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Password is incorrect.')
  }

  const deletedUser = await User.findOneAndUpdate(
    { _id: userId, status: { $nin: [USER_STATUS.DELETED] } },
    { $set: { status: USER_STATUS.DELETED } },
    { new: true },
  )

  if (!deletedUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to delete profile.')
  }

  return 'Profile deleted successfully.'
}

const getUserById = async (userId: string): Promise<any> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const user = await User.findOne({
    _id: userId,
    status: { $nin: [USER_STATUS.DELETED] },
  })
    .select('-password -authentication -__v')
    .populate('purchasedMaps', 'name country images coverPhoto price description')
    .populate('deactivatedMaps', 'name country images coverPhoto price description')
    .populate('favoriteMaps', 'name country images')
    .populate('assignedMaps', 'name country')
    .populate('redeemedFreeMap', 'name country')
    .populate('redeemedFreeMaps', 'name country')
    .lean()

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  // Calculate dynamic level info synchronized with settings on rewards page
  const points = (user as any).points || 0
  const approvedReviews = (user as any).totalReviewsApproved || 0
  const levelInfo = await LevelConfigServices.getDynamicUserLevel(
    points,
    approvedReviews
  )

  // Keep stored user.level in sync if it differed
  if (user.level !== levelInfo.levelNumber) {
    User.findByIdAndUpdate(userId, {
      $set: { level: levelInfo.levelNumber },
    })
      .exec()
      .catch(() => {})
  }

  // Fetch claimed offer redemptions
  const offerRedemptions = await OfferRedemption.find({ user: userId })
    .populate({
      path: 'offer',
      populate: { path: 'place business', select: 'name' },
    })
    .sort({ createdAt: -1 })
    .lean()

  // The admin prize list contains earned rewards, ordered by milestone.
  const awards = await Award.find({ userId, isUnlocked: true })
    .populate('configId')
    .sort({ target: 1, createdAt: 1, _id: 1 })
    .lean()

  // Fetch user's submitted reviews
  const reviews = await Review.find({ reviewer: userId })
    .populate('placeId', 'name')
    .populate('businessId', 'name')
    .sort({ createdAt: -1 })
    .lean()

  // Fetch user's visited places (Issue 4: places viewed/visited)
  const visitedPlaces = await Visited.find({ user: userId })
    .populate('place', 'name address location media country category')
    .populate('business', 'name location')
    .sort({ visitedAt: -1 })
    .lean()

  // Compute last activity and activity summary
  const activityTimestamps: number[] = [
    user.updatedAt ? new Date(user.updatedAt).getTime() : 0,
    user.createdAt ? new Date(user.createdAt).getTime() : 0,
    ...visitedPlaces.map((v: any) => (v.visitedAt ? new Date(v.visitedAt).getTime() : 0)),
    ...reviews.map((r: any) => (r.createdAt ? new Date(r.createdAt).getTime() : 0)),
    ...offerRedemptions.map((o: any) => (o.redemptionTime || o.createdAt ? new Date(o.redemptionTime || o.createdAt).getTime() : 0)),
  ].filter(t => t > 0)

  const lastActivityAt = activityTimestamps.length > 0
    ? new Date(Math.max(...activityTimestamps))
    : user.updatedAt || user.createdAt

  // Build unified chronological activity timeline
  const activityTimeline: any[] = []

  visitedPlaces.forEach((v: any) => {
    activityTimeline.push({
      type: 'place_visit',
      title: 'Visited Place',
      name: v.place?.name
        ? (localizeField(v.place.name, 'en') || localizeField(v.place.name, 'es') || (typeof v.place.name === 'string' ? v.place.name : ''))
        : v.business?.name
          ? (localizeField(v.business.name, 'en') || localizeField(v.business.name, 'es') || (typeof v.business.name === 'string' ? v.business.name : ''))
          : 'Place',
      location: v.place?.address || v.place?.country || v.business?.location?.city,
      media: v.place?.media?.[0],
      targetId: v.place?._id ? String(v.place._id) : v.business?._id ? String(v.business._id) : undefined,
      targetType: v.place?._id ? 'place' : 'business',
      timestamp: v.visitedAt || v.createdAt,
    })
  })

  reviews.forEach((r: any) => {
    activityTimeline.push({
      type: 'review_submitted',
      title: `Submitted a ${r.rating || 5}★ Review`,
      name: r.placeId?.name
        ? (localizeField(r.placeId.name, 'en') || localizeField(r.placeId.name, 'es') || (typeof r.placeId.name === 'string' ? r.placeId.name : ''))
        : r.businessId?.name
          ? (localizeField(r.businessId.name, 'en') || localizeField(r.businessId.name, 'es') || (typeof r.businessId.name === 'string' ? r.businessId.name : ''))
          : 'Place/Business',
      rating: r.rating,
      comment: typeof r.review === 'string' ? r.review : r.review?.en || r.review?.es || r.review?.comment || '',
      targetId: r.placeId?._id ? String(r.placeId._id) : r.businessId?._id ? String(r.businessId._id) : undefined,
      targetType: r.placeId?._id ? 'place' : 'business',
      timestamp: r.createdAt,
    })
  })

  offerRedemptions.forEach((o: any) => {
    activityTimeline.push({
      type: 'offer_claimed',
      title: 'Claimed Special Offer',
      name: o.offer?.title
        ? (localizeField(o.offer.title, 'en') || localizeField(o.offer.title, 'es') || (typeof o.offer.title === 'string' ? o.offer.title : ''))
        : 'Special Offer',
      businessName: o.offer?.business?.name
        ? (localizeField(o.offer.business.name, 'en') || localizeField(o.offer.business.name, 'es') || (typeof o.offer.business.name === 'string' ? o.offer.business.name : ''))
        : o.offer?.place?.name
          ? (localizeField(o.offer.place.name, 'en') || localizeField(o.offer.place.name, 'es') || (typeof o.offer.place.name === 'string' ? o.offer.place.name : ''))
          : undefined,
      targetId: o.offer?._id ? String(o.offer._id) : undefined,
      targetType: 'offer',
      timestamp: o.redemptionTime || o.createdAt,
    })
  })

  activityTimeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const activitySummary = {
    totalPlacesVisited: visitedPlaces.length,
    totalReviewsSubmitted: reviews.length,
    totalOffersClaimed: offerRedemptions.length,
    totalMapsActivated: (user.purchasedMaps || []).length,
    lastActivityAt,
  }

  return {
    ...user,
    level: levelInfo.levelNumber,
    levelInfo,
    offerRedemptions,
    awards,
    reviews,
    visitedPlaces,
    activitySummary,
    activityTimeline,
  }
}

/** Public, shareable profile — safe fields only */
const getPublicProfile = async (userId: string, requester?: any) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const user = await User.findOne({
    _id: userId,
    status: { $ne: USER_STATUS.DELETED },
  }).select(
    'name profile level points role createdAt website instagram description specialty settings.profileStatus visitedPlacesCount address',
  )

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Profile not found.')
  }

  const requesterId = requester?.authId || requester?._id
  const isOwner = Boolean(requesterId && String(requesterId) === String(userId))
  const isStaff = Boolean(
    requester &&
      [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN].includes(
        requester.role,
      ),
  )

  if (['private', 'anonymous'].includes(user.settings?.profileStatus || '') && !isOwner && !isStaff) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'This profile is private.')
  }

  // Fetch user's approved reviews with place/business names
  const reviews = await Review.find({
    reviewer: userId,
    status: 'Approved',
  })
    .populate('placeId', 'name media address')
    .populate('businessId', 'name media.photos location')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()

  // Fetch approved tourist spots discovered by this user
  const discoveredPlaces = await Place.find({
    discoveredBy: userId,
    status: 'Published',
  })
    .select('name media address rating totalReview category map createdAt')
    .populate('category', 'name icon color')
    .populate('map', 'name country')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()

  const points = (user as any).points || 0
  const approvedReviews = (user as any).totalReviewsApproved || 0
  const levelInfo = await LevelConfigServices.getDynamicUserLevel(
    points,
    approvedReviews
  )

  const userObj = user.toObject()
  if (userObj.profile === '/images/1767048629458-l94gk7.jpg') {
    userObj.profile = ''
  }

  return {
    ...userObj,
    level: levelInfo.levelNumber,
    levelInfo,
    reviews,
    discoveredPlaces,
    approvedRecommendedPlacesCount: discoveredPlaces.length,
  }
}

const updateUserStatus = async (
  userId: string,
  status: USER_STATUS,
  actor?: JwtPayload,
) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const isUserExist = await User.findOne({
    _id: userId,
    status: { $nin: [USER_STATUS.DELETED] },
  })
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  // Admin cannot change super_admin status
  if (
    isUserExist.role === USER_ROLES.SUPER_ADMIN &&
    actor?.role !== USER_ROLES.SUPER_ADMIN
  ) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Only Super Admin can update Super Admin status.',
    )
  }

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, status: { $nin: [USER_STATUS.DELETED] } },
    { $set: { status } },
    { new: true },
  )

  if (!updatedUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update user status.')
  }

  return 'User status updated successfully.'
}

const assertCanAssignRole = (
  actorRole: string | undefined,
  targetRole: USER_ROLES,
  existingRole?: string,
) => {
  if (!actorRole) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized.')
  }

  // Only super_admin can create / manage super_admin
  if (
    (targetRole === USER_ROLES.SUPER_ADMIN ||
      existingRole === USER_ROLES.SUPER_ADMIN) &&
    actorRole !== USER_ROLES.SUPER_ADMIN
  ) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Only Super Admin can manage Super Admin accounts.',
    )
  }

  if (
    actorRole !== USER_ROLES.ADMIN &&
    actorRole !== USER_ROLES.SUPER_ADMIN
  ) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You are not authorized.')
  }
}

const assertCanDeleteUser = (
  actorRole: string | undefined,
  targetRole: string | undefined,
) => {
  if (!actorRole) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized.')
  }
  if (!targetRole) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Target user role is missing.')
  }

  if (targetRole === USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Super Admin accounts cannot be deleted this way.',
    )
  }

  if (actorRole === USER_ROLES.SUPER_ADMIN) {
    return
  }

  if (actorRole === USER_ROLES.ADMIN) {
    // Admin can delete regular users and map editors only
    if (
      targetRole === USER_ROLES.USER ||
      targetRole === USER_ROLES.MAP_EDITOR
    ) {
      return
    }
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Admins cannot delete other admin accounts.',
    )
  }

  throw new ApiError(StatusCodes.FORBIDDEN, 'You are not authorized.')
}

const updateUserRole = async (
  userId: string,
  role: USER_ROLES,
  assignedMaps?: string[],
  assignedCountries?: string[],
  actor?: JwtPayload,
) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const isUserExist = await User.findOne({
    _id: userId,
    status: { $nin: [USER_STATUS.DELETED] },
  })
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  assertCanAssignRole(actor?.role, role, isUserExist.role)

  const updateData: any = { role }

  if (role === USER_ROLES.MAP_EDITOR) {
    const maps = assignedMaps || []
    const countries = assignedCountries || []
    if (maps.length === 0 && countries.length === 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Map Editor must be assigned at least one map or country.',
      )
    }
    updateData.assignedMaps = maps
    updateData.assignedCountries = countries
  } else {
    // Clear editor scope when leaving map_editor
    updateData.assignedMaps = []
    updateData.assignedCountries = []
  }

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, status: { $nin: [USER_STATUS.DELETED] } },
    { $set: updateData },
    { new: true },
  )

  if (!updatedUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update user role.')
  }

  return 'User role updated successfully.'
}

const inviteUser = async (
  payload: {
    email: string
    role: USER_ROLES
    assignedMaps?: string[]
    assignedCountries?: string[]
  },
  actor?: JwtPayload,
) => {
  const email = payload.email.toLowerCase().trim()

  assertCanAssignRole(actor?.role, payload.role)

  const isUserExist = await User.findOne({ email })

  if (isUserExist && isUserExist.verified) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'User with this email already exists and is verified.',
    )
  }

  const otp = generateOtp()
  const otpExpiresIn = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours for invitation

  const authentication = {
    oneTimeCode: otp,
    expiresAt: otpExpiresIn,
    latestRequestAt: new Date(),
    requestCount: 1,
    authType: 'createAccount',
  }

  const baseUpdate: any = {
    role: payload.role,
    status: USER_STATUS.ACTIVE,
    verified: false,
    authentication,
  }

  if (payload.role === USER_ROLES.MAP_EDITOR) {
    const maps = payload.assignedMaps || []
    const countries = payload.assignedCountries || []
    if (maps.length === 0 && countries.length === 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Map Editor must be assigned at least one map or country.',
      )
    }
    baseUpdate.assignedMaps = maps
    baseUpdate.assignedCountries = countries
  } else {
    // Re-invite as non-editor — clear any previous editor scope
    baseUpdate.assignedMaps = []
    baseUpdate.assignedCountries = []
  }

  let user
  if (isUserExist) {
    // Update existing unverified or deleted user
    user = await User.findOneAndUpdate(
      { email },
      { $set: baseUpdate },
      { new: true },
    )
  } else {
    // Create new user
    user = await User.create({
      email,
      ...baseUpdate
    })
  }

  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to invite user.')
  }

  // Send invitation email
  const invitationEmail = emailTemplate.userInvitation({
    email: user.email as string,
    role: user.role as string,
    otp,
  })

  await emailHelper.sendEmail(invitationEmail)

  return 'User invited successfully.'
}

export const getProfile = async (user: JwtPayload) => {
  // --- Fetch user ---
  const isUserExist = await User.findOne({
    _id: user.authId,
    status: { $nin: [USER_STATUS.DELETED] },
  })
    .select('-authentication -password -__v')
    .populate('assignedMaps', 'name country')
    .populate('redeemedFreeMap', 'name country')
    .populate('redeemedFreeMaps', 'name country')

  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  const points = (isUserExist as any).points || 0
  const approvedReviews = (isUserExist as any).totalReviewsApproved || 0
  const levelInfo = await LevelConfigServices.getDynamicUserLevel(
    points,
    approvedReviews
  )

  if (isUserExist.level !== levelInfo.levelNumber) {
    User.findByIdAndUpdate(user.authId, {
      $set: { level: levelInfo.levelNumber },
    })
      .exec()
      .catch(() => {})
  }

  const approvedRecommendedPlacesCount = await Place.countDocuments({
    discoveredBy: user.authId,
    $or: [
      { status: 'Published' },
      { isApproved: true },
      { pointsAwarded: { $gt: 0 } },
    ],
  })

  const userObj = isUserExist.toObject()
  if (userObj.profile === '/images/1767048629458-l94gk7.jpg') {
    userObj.profile = ''
  }

  return {
    ...userObj,
    level: levelInfo.levelNumber,
    levelInfo,
    approvedRecommendedPlacesCount,
  }
}

const addUserInterest = async (
  userId: string,
  interest: InterestCategory[],
): Promise<IUser | null> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const isUserExist = await User.findOne({
    _id: userId,
    status: { $nin: [USER_STATUS.DELETED] },
  })
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }
  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, status: { $nin: [USER_STATUS.DELETED] } },
    { $set: { interest } },
    { new: true },
  )
  if (!updatedUser) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Failed to update user interest.',
    )
  }
  return updatedUser
}

const toggleFavoriteMap = async (
  userId: string,
  mapId: string,
) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }
  if (!Types.ObjectId.isValid(mapId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Map ID.')
  }

  const isUserExist = await User.findById(userId)

  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  const isFavorite = isUserExist.favoriteMaps?.includes(
    new Types.ObjectId(mapId),
  )

  const updateDoc = isFavorite
    ? {
        $pull: { favoriteMaps: mapId },
      }
    : {
        $addToSet: { favoriteMaps: mapId },
      }

  const result = await User.findByIdAndUpdate(userId, updateDoc, { new: true })
  return result
}

const getFavoriteMaps = async (userId: string) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const user = await User.findById(userId)
    .populate({
      path: 'favoriteMaps',
      select:
        'name country images isActive isPaid price rating totalReview createdAt description',
    })
    .lean()

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  return user.favoriteMaps || []
}

const toggleFavoriteOffer = async (
  userId: string,
  offerId: string,
): Promise<string> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }
  if (!Types.ObjectId.isValid(offerId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Offer ID.')
  }

  const isUserExist = await User.findById(userId)
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  const isFavorite = isUserExist.favoriteOffers?.includes(
    new Types.ObjectId(offerId),
  )

  if (isFavorite) {
    await User.findByIdAndUpdate(userId, {
      $pull: { favoriteOffers: offerId },
    })
    return 'Offer removed from favorites.'
  } else {
    await User.findByIdAndUpdate(userId, {
      $addToSet: { favoriteOffers: offerId },
    })
    return 'Offer added to favorites.'
  }
}

const getFavoriteOffers = async (userId: string) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const user = await User.findById(userId).populate({
    path: 'favoriteOffers',
    populate: { path: 'place' },
  })

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  return user.favoriteOffers || []
}

const updatePointsAndLevel = async (userId: string, pointsToAdd: number) => {
  const user = await User.findById(userId)
  if (!user) return

  const oldLevel = user.level || 0
  const newPoints = (user.points || 0) + pointsToAdd
  const newApprovedCount = user.totalReviewsApproved || 0
  const levelInfo = await LevelConfigServices.getDynamicUserLevel(
    newPoints,
    newApprovedCount
  )
  const newLevel = levelInfo.levelNumber

  await User.findByIdAndUpdate(userId, {
    $set: {
      points: newPoints,
      level: newLevel,
    },
  })

  if (newLevel > oldLevel) {
    NotificationIntegration.onLevelUnlocked({
      userId,
      newLevel,
      levelName: levelInfo.title || `Nivel ${newLevel}`,
      oldLevel,
    }).catch(err => console.error('Failed to notify level unlock:', err))
  }
}

const assignEditorAccess = async (
  userId: string,
  assignedMaps?: string[],
  assignedCountries?: string[]
) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }

  const user = await User.findById(userId)
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  if (user.role !== USER_ROLES.MAP_EDITOR) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a MAP_EDITOR.')
  }

  const maps = assignedMaps ?? user.assignedMaps?.map((id: any) => id.toString()) ?? []
  const countries = assignedCountries ?? user.assignedCountries ?? []

  if (maps.length === 0 && countries.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Map Editor must be assigned at least one map or country.',
    )
  }

  const updateData: any = {}
  if (assignedMaps !== undefined) {
    updateData.assignedMaps = assignedMaps
  }
  if (assignedCountries !== undefined) {
    updateData.assignedCountries = assignedCountries
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true }
  )

  return updatedUser
}

const updateUserMapAccess = async (
  userId: string,
  mapId: string,
  action: 'deactivate' | 'reactivate' | 'grant' | 'remove',
  actor?: JwtPayload,
) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID.')
  }
  if (!Types.ObjectId.isValid(mapId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Map ID.')
  }

  const user = await User.findOne({
    _id: userId,
    status: { $nin: [USER_STATUS.DELETED] },
  })
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found.')
  }

  const map = await Map.findById(mapId)
  if (!map) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found.')
  }

  const mapObjectId = new Types.ObjectId(mapId)
  let updateDoc: any = {}
  let message = ''

  if (action === 'deactivate' || action === 'remove') {
    // Remove from purchasedMaps, add to deactivatedMaps
    updateDoc = {
      $pull: { purchasedMaps: mapObjectId },
      $addToSet: { deactivatedMaps: mapObjectId },
    }
    message = 'Map access deactivated successfully.'
  } else if (action === 'reactivate' || action === 'grant') {
    // Add to purchasedMaps, remove from deactivatedMaps
    updateDoc = {
      $addToSet: { purchasedMaps: mapObjectId },
      $pull: { deactivatedMaps: mapObjectId },
    }
    message = 'Map access activated successfully.'
  }

  const updatedUser = await User.findByIdAndUpdate(userId, updateDoc, {
    new: true,
  })
    .select('-password -authentication -__v')
    .populate('purchasedMaps', 'name country images coverPhoto price description')
    .populate('deactivatedMaps', 'name country images coverPhoto price description')

  if (!updatedUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update map access.')
  }

  return { message, user: updatedUser }
}

export const UserServices = {
  updateProfile,
  createAdmin,
  getAllUsers,
  deleteUser,
  getUserById,
  getPublicProfile,
  updateUserStatus,
  updateUserRole,
  inviteUser,
  getProfile,
  deleteProfile,
  addUserInterest,
  toggleFavoriteMap,
  getFavoriteMaps,
  toggleFavoriteOffer,
  getFavoriteOffers,
  updatePointsAndLevel,
  assignEditorAccess,
  updateUserMapAccess,
}
