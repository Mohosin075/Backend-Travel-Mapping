import { StatusCodes } from 'http-status-codes'
import { sanitizeReviewIdentity } from '../../helpers/profilePrivacy'
import ApiError from '../../errors/ApiError'
import { IReview } from './review.interface'
import { Review } from './review.model'
import { JwtPayload } from 'jsonwebtoken'
import mongoose from 'mongoose'
import { User } from '../user/user.model'
import { Place } from '../place/place.model'
import { Business } from '../business/business.model'
import { Map } from '../map/map.model'
import { USER_ROLES } from '../../enum/user'
import { IPaginationOptions } from '../../interfaces/pagination'
import { paginationHelper } from '../../helpers/paginationHelper'
import { AwardServices } from '../award/award.service'
import { NotificationIntegration } from '../notification/notification.integration'
import { autoTranslateField } from '../../utils/autoTranslate'
import { calculateUserLevel, USER_LEVELS } from '../../constants/userLevels.constant'
import { LevelConfigServices } from '../award/levelConfig.service'

import { getAccessibleMapIds } from '../../helpers/mapAccessHelper'

const ratingIncPipeline = (rating: number) => [
  {
    $set: {
      totalReview: { $add: [{ $ifNull: ['$totalReview', 0] }, 1] },
      rating: {
        $divide: [
          {
            $add: [
              {
                $multiply: [
                  { $ifNull: ['$rating', 0] },
                  { $ifNull: ['$totalReview', 0] },
                ],
              },
              rating,
            ],
          },
          { $add: [{ $ifNull: ['$totalReview', 0] }, 1] },
        ],
      },
    },
  },
]

const ratingDecPipeline = (rating: number) => [
  {
    $set: {
      rating: {
        $cond: [
          { $lte: ['$totalReview', 1] },
          0,
          {
            $divide: [
              {
                $subtract: [
                  { $multiply: ['$rating', '$totalReview'] },
                  rating,
                ],
              },
              { $subtract: ['$totalReview', 1] },
            ],
          },
        ],
      },
      totalReview: {
        $cond: [
          { $lte: ['$totalReview', 1] },
          0,
          { $subtract: ['$totalReview', 1] },
        ],
      },
    },
  },
]

const createReview = async (user: JwtPayload, payload: IReview) => {
  payload.reviewer = user.authId as unknown as mongoose.Types.ObjectId
  // Force review status to Pending on creation
  payload.status = 'Pending'
  payload.isVerified = false
  payload.pointsEarned = 0

  if (payload.review) {
    payload.review = await autoTranslateField(payload.review)
  }

  const isUserExist = await User.findById(user.authId)
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  if (payload.placeId) {
    const isPlaceExist = await Place.findById(payload.placeId)
    if (!isPlaceExist) {
      // Fallback: Check if this ID is a Business (similar to PlaceService.getPlaceById fallback)
      const isBusinessExist = await Business.findById(payload.placeId)
      if (isBusinessExist) {
        payload.businessId = payload.placeId as any
        delete (payload as any).placeId
        if (isBusinessExist.status !== 'Approved') {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Only approved businesses can be reviewed.',
          )
        }
      } else {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
      }
    }
  } else if (payload.businessId) {
    const isBusinessExist = await Business.findById(payload.businessId)
    if (!isBusinessExist) {
      // Fallback: Check if this ID is a Place
      const isPlaceExist = await Place.findById(payload.businessId)
      if (isPlaceExist) {
        payload.placeId = payload.businessId as any
        delete (payload as any).businessId
      } else {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Business not found')
      }
    } else {
      if (isBusinessExist.status !== 'Approved') {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Only approved businesses can be reviewed.',
        )
      }
    }
  } else {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Either placeId or businessId is required',
    )
  }

  const result = await Review.create(payload)
  if (!result) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Failed to create Review, please try again later.',
    )
  }

  return result
}

const getAllReviews = async (
  paginationOptions: IPaginationOptions,
  filter: any = {},
  requester?: any,
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelper.calculatePagination(paginationOptions)

  const [result, total] = await Promise.all([
    Review.find(filter)
      .populate('reviewer', 'name profile level purchasedMaps settings.profileStatus')
      .populate({
        path: 'placeId',
        select: 'name media map address category country',
        populate: { path: 'map', select: 'name country' },
      })
      .populate('businessId', 'name media location')
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder }),
    Review.countDocuments(filter),
  ])

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: result.map(review => sanitizeReviewIdentity(review, requester)),
  }
}

const getReviewsByPlace = async (
  placeId: string,
  paginationOptions: IPaginationOptions,
  userId?: string,
  userRole?: string,
) => {
  // If this ID is a Business, automatically query by businessId
  const isBusiness = await Business.exists({ _id: placeId })
  const targetFilter = isBusiness ? { businessId: placeId } : { placeId }

  const filter: any = {
    ...targetFilter,
    $or: [
      { status: 'Approved' },
      ...(userId ? [{ reviewer: userId }] : []),
    ],
  }
  return await getAllReviews(paginationOptions, filter, { authId: userId, role: userRole })
}

const getReviewsByBusiness = async (
  businessId: string,
  paginationOptions: IPaginationOptions,
  userId?: string,
  userRole?: string,
) => {
  // If this ID is a Place, automatically query by placeId
  const isPlace = await Place.exists({ _id: businessId })
  const targetFilter = isPlace ? { placeId: businessId } : { businessId }

  const filter: any = {
    ...targetFilter,
    $or: [
      { status: 'Approved' },
      ...(userId ? [{ reviewer: userId }] : []),
    ],
  }
  return await getAllReviews(paginationOptions, filter, { authId: userId, role: userRole })
}

const updateReview = async (
  user: JwtPayload,
  id: string,
  payload: Partial<IReview>,
) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const existingReview = await Review.findById(id).session(session)

    if (!existingReview) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found.')
    }
    if (existingReview?.reviewer.toString() !== user.authId) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        'You are not authorized to update this review.',
      )
    }

    const oldRating = existingReview.rating
    const newRating = payload.rating ?? oldRating

    // If review body or rating changes, reset status to Pending to trigger admin re-verification
    if (payload.review !== undefined || payload.rating !== undefined || payload.media !== undefined) {
      payload.status = 'Pending'
      payload.isVerified = false
      payload.pointsEarned = 0
    }

    if (payload.review !== undefined) {
      payload.review = await autoTranslateField(payload.review)
    }

    // Update place/business stats and user points if the review was Approved but is now going back to Pending (due to edit)
    if (existingReview.status === 'Approved' && (payload.review !== undefined || payload.rating !== undefined || payload.media !== undefined)) {
      const rating = existingReview.rating

      if (existingReview.placeId) {
        await Place.findByIdAndUpdate(
          existingReview.placeId,
          ratingDecPipeline(rating),
          { session, new: true },
        )
      } else if (existingReview.businessId) {
        await Business.findByIdAndUpdate(
          existingReview.businessId,
          ratingDecPipeline(rating),
          { session, new: true },
        )
      }

      // Deduct points from user
      const reviewerId = existingReview.reviewer.toString()
      const pointsToDeduct = existingReview.pointsEarned || 0
      const reviewer = await User.findById(reviewerId).session(session)
      if (reviewer) {
        const newPoints = Math.max(0, (reviewer.points || 0) - pointsToDeduct)
        const newApprovedCount = Math.max(0, (reviewer.totalReviewsApproved || 0) - 1)
        
        const levelInfo = await LevelConfigServices.getDynamicUserLevel(newPoints, newApprovedCount)
        const newLevel = levelInfo.levelNumber

        await User.findByIdAndUpdate(
          reviewerId,
          { $set: { points: newPoints, totalReviewsApproved: newApprovedCount, level: newLevel } },
          { session }
        )
      }
    }

    const result = await Review.findByIdAndUpdate(id, payload, {
      new: true,
      session,
    })

    await session.commitTransaction()
    return result
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    await session.endSession()
  }
}

const deleteReview = async (user: JwtPayload, id: string) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const existingReview = await Review.findById(id).session(session)
    if (!existingReview) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found.')
    }

    if (
      user.role !== 'admin' &&
      user.role !== 'super_admin' &&
      existingReview.reviewer.toString() !== user.authId
    ) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        'You are not authorized to delete this review.',
      )
    }

    // If the review was approved, we need to update the place/business ratings/stats and reduce user points
    if (existingReview.status === 'Approved') {
      const rating = existingReview.rating

      if (existingReview.placeId) {
        await Place.findByIdAndUpdate(
          existingReview.placeId,
          ratingDecPipeline(rating),
          { session, new: true },
        )
      } else if (existingReview.businessId) {
        await Business.findByIdAndUpdate(
          existingReview.businessId,
          ratingDecPipeline(rating),
          { session, new: true },
        )
      }

      // Deduct points from user
      const reviewerId = existingReview.reviewer.toString()
      const pointsToDeduct = existingReview.pointsEarned || 0
      const reviewer = await User.findById(reviewerId).session(session)
      if (reviewer) {
        const newPoints = Math.max(0, (reviewer.points || 0) - pointsToDeduct)
        const newApprovedCount = Math.max(0, (reviewer.totalReviewsApproved || 0) - 1)
        
        const levelInfo = await LevelConfigServices.getDynamicUserLevel(newPoints, newApprovedCount)
        const newLevel = levelInfo.levelNumber

        await User.findByIdAndUpdate(
          reviewerId,
          { $set: { points: newPoints, totalReviewsApproved: newApprovedCount, level: newLevel } },
          { session }
        )
      }
    }

    const result = await Review.findByIdAndDelete(id, { session })

    await session.commitTransaction()
    return result
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    await session.endSession()
  }
}

const getSingleReview = async (id: string, requester?: any) => {
  const result = await Review.findById(id).populate('reviewer', 'name profile settings.profileStatus')
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found.')
  }
  return sanitizeReviewIdentity(result, requester)
}

const getMyReviews = async (
  user: JwtPayload,
  paginationOptions: IPaginationOptions,
) => {
  return await getAllReviews(paginationOptions, { reviewer: user.authId }, user)
}

const approveReview = async (id: string) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const existingReview = await Review.findById(id).session(session)
    if (!existingReview) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found')
    }
    if (existingReview.status === 'Approved') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Review is already approved')
    }

    // 1. Calculate potential points based on new point rules:
    // 1. Star rating: +1 point
    // 2. Review text: +4 points
    // 3. Review >= 200 characters: +5 bonus points (total 10 points)
    let potentialPoints = 1
    const reviewContent =
      typeof existingReview.review === 'object' && existingReview.review !== null
        ? ((existingReview.review as any).es || (existingReview.review as any).en || '')
        : (typeof existingReview.review === 'string' ? existingReview.review : '')
    if (reviewContent && reviewContent.trim() !== '') {
      potentialPoints += 4
      if (reviewContent.trim().length >= 200) {
        potentialPoints += 5
      }
    }

    // 2. Check if reviewer has purchased the map for this review
    // Points are earned ONLY for reviews of maps they have actually purchased.
    const reviewerId = existingReview.reviewer.toString()
    const reviewer = await User.findById(reviewerId).session(session)

    let isMapPurchased = false
    if (reviewer) {
      if ([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(reviewer.role as any)) {
        isMapPurchased = true
      } else {
        const userPurchasedMapIds = (reviewer.purchasedMaps || []).map((m: any) =>
          m ? (m._id ? m._id.toString() : m.toString()) : ''
        )
        if (existingReview.placeId) {
          const place = await Place.findById(existingReview.placeId).session(session)
          const rawMap = place?.map
          const mapId = rawMap ? (rawMap._id ? rawMap._id.toString() : rawMap.toString()) : null
          if (mapId && userPurchasedMapIds.includes(mapId)) {
            isMapPurchased = true
          }
        } else if (existingReview.businessId) {
          const business = await Business.findById(existingReview.businessId).session(session)
          const bizCountry = business?.location?.country
          if (bizCountry) {
            const countryMap = await Map.findOne({
              country: { $regex: new RegExp(`^${bizCountry.trim()}$`, 'i') },
            }).session(session)
            if (countryMap && userPurchasedMapIds.includes(countryMap._id.toString())) {
              isMapPurchased = true
            }
          }
        }
      }
    }

    // Award the full calculated points upon admin approval (1pt rating, +4pts text, +5pts 200+ chars)
    const points = potentialPoints

    // Update review status
    const updatedReview = await Review.findByIdAndUpdate(
      id,
      { $set: { status: 'Approved', isVerified: true, pointsEarned: points } },
      { session, new: true }
    )

    // 3. Update user points, approved review count, and recalculate level
    let levelUnlockedData: { newLevel: number; levelName: string; oldLevel: number } | null = null

    if (reviewer) {
      const oldLevel = reviewer.level || 0
      const newPoints = (reviewer.points || 0) + points
      const newApprovedCount = (reviewer.totalReviewsApproved || 0) + 1

      const levelInfo = await LevelConfigServices.getDynamicUserLevel(newPoints, newApprovedCount)
      const newLevel = levelInfo.levelNumber

      if (newLevel > oldLevel) {
        levelUnlockedData = {
          newLevel,
          levelName: levelInfo.title || `Nivel ${newLevel}`,
          oldLevel,
        }
      }

      await User.findByIdAndUpdate(
        reviewerId,
        { $set: { points: newPoints, totalReviewsApproved: newApprovedCount, level: newLevel } },
        { session }
      )

      // Award update
      await AwardServices.updateAwardProgress(reviewerId, 'Top Reviewer', 1)
    }

    // 3. Update the place/business rating and total reviews
    if (existingReview.placeId) {
      await Place.findByIdAndUpdate(
        existingReview.placeId,
        ratingIncPipeline(existingReview.rating),
        { session, new: true },
      )
    } else if (existingReview.businessId) {
      await Business.findByIdAndUpdate(
        existingReview.businessId,
        ratingIncPipeline(existingReview.rating),
        { session, new: true },
      )
    }

    await session.commitTransaction()

    // Send notifications to reviewer
    try {
      const targetName = existingReview.placeId
        ? (await Place.findById(existingReview.placeId).select('name').lean())?.name
        : (await Business.findById(existingReview.businessId).select('name').lean())?.name

      const resolvedTargetName =
        typeof targetName === 'object' && targetName !== null
          ? (targetName as any).es || (targetName as any).en || 'lugar'
          : targetName || 'lugar'

      // Send review approval notification
      await NotificationIntegration.onReviewApproved({
        reviewerId,
        targetName: resolvedTargetName,
        points,
        placeId: existingReview.placeId,
        businessId: existingReview.businessId,
      })

      // Send level unlock notification if user leveled up
      if (levelUnlockedData) {
        await NotificationIntegration.onLevelUnlocked({
          userId: reviewerId,
          newLevel: levelUnlockedData.newLevel,
          levelName: levelUnlockedData.levelName,
          oldLevel: levelUnlockedData.oldLevel,
        })
      }
    } catch (notifErr) {
      console.error('Failed to send review approval/level notifications:', notifErr)
    }

    return updatedReview
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    await session.endSession()
  }
}

const rejectReview = async (id: string) => {
  const existingReview = await Review.findById(id)
  if (!existingReview) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found')
  }
  if (existingReview.status === 'Approved') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Cannot reject an already approved review')
  }

  const result = await Review.findByIdAndUpdate(
    id,
    { $set: { status: 'Rejected', isVerified: false, pointsEarned: 0 } },
    { new: true }
  )

  // Send in-app notification to reviewer
  try {
    const targetName = existingReview.placeId
      ? (await Place.findById(existingReview.placeId).select('name').lean())?.name
      : (await Business.findById(existingReview.businessId).select('name').lean())?.name

    const resolvedTargetName =
      typeof targetName === 'object' && targetName !== null
        ? (targetName as any).es || (targetName as any).en || 'lugar'
        : targetName || 'lugar'

    await NotificationIntegration.onReviewRejected({
      reviewerId: existingReview.reviewer.toString(),
      targetName: resolvedTargetName,
      placeId: existingReview.placeId,
      businessId: existingReview.businessId,
    })
  } catch (notifErr) {
    console.error('Failed to send review rejection notification:', notifErr)
  }

  return result
}

export const ReviewService = {
  createReview,
  getAllReviews,
  getReviewsByPlace,
  getReviewsByBusiness,
  updateReview,
  deleteReview,
  getSingleReview,
  getMyReviews,
  approveReview,
  rejectReview,
}
