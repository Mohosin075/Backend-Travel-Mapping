import { StatusCodes } from 'http-status-codes'
import mongoose from 'mongoose'
import ApiError from '../../errors/ApiError'
import { Visited } from './visited.model'
import { Place } from '../place/place.model'
import { Business } from '../business/business.model'
import { User } from '../user/user.model'
import { getCountryScope } from '../../helpers/countryScope'

interface IToggleVisitedPayload {
  placeId?: string
  place?: string
  business?: string
  id?: string
  type?: 'Place' | 'Business'
}

const toggleVisited = async (
  userId: string,
  payload: IToggleVisitedPayload
): Promise<{ isVisited: boolean; visitedCount: number; data?: any }> => {
  const targetId = payload.placeId || payload.place || payload.business || payload.id
  if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'A valid location ID is required')
  }

  const session = await mongoose.startSession()

  try {
    session.startTransaction()

    // 1. Determine whether targetId belongs to Place or Business
    let locationType: 'Place' | 'Business' = payload.type || 'Place'
    const isPlaceExist = await Place.findById(targetId).session(session)
    let isBusinessExist = null

    if (!isPlaceExist) {
      isBusinessExist = await Business.findById(targetId).session(session)
      if (isBusinessExist) {
        locationType = 'Business'
      } else {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Location not found')
      }
    } else {
      locationType = isPlaceExist.type === 'Business' ? 'Business' : 'Place'
    }

    // 2. Check if already marked as visited
    const existing = await Visited.findOne({
      user: userId,
      $or: [{ place: targetId }, { business: targetId }],
    }).session(session)

    if (existing) {
      // Unmark visited
      await Visited.findByIdAndDelete(existing._id).session(session)

      if (existing.type === 'Business' || existing.business) {
        const bId = existing.business || targetId
        await Business.findByIdAndUpdate(
          bId,
          { $inc: { viewCount: -1 } },
          { session }
        )
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $pull: { visitedPlaces: targetId },
        },
        { new: true, session }
      )

      // Sync count based on actual length
      const actualCount = updatedUser?.visitedPlaces ? updatedUser.visitedPlaces.length : 0
      await User.findByIdAndUpdate(
        userId,
        { $set: { visitedPlacesCount: actualCount } },
        { session }
      )

      await session.commitTransaction()
      return { isVisited: false, visitedCount: actualCount }
    } else {
      // Mark as visited
      const newRecord = await Visited.create(
        [
          {
            user: userId,
            ...(locationType === 'Business' ? { business: targetId } : { place: targetId }),
            type: locationType,
            visitedAt: new Date(),
          },
        ],
        { session }
      )

      if (locationType === 'Business') {
        await Business.findByIdAndUpdate(
          targetId,
          { $inc: { viewCount: 1 } },
          { session }
        )
      } else if (isPlaceExist) {
        const placeName =
          (typeof isPlaceExist.name === 'object'
            ? (isPlaceExist.name as any)?.es || (isPlaceExist.name as any)?.en
            : isPlaceExist.name) || (isPlaceExist as any).name_es || ''
        if (placeName) {
          const matchingBiz = await Business.findOne({
            $or: [
              { name: placeName },
              { 'name.en': placeName },
              { 'name.es': placeName },
            ],
          }).session(session)
          if (matchingBiz) {
            await Business.findByIdAndUpdate(
              matchingBiz._id,
              { $inc: { viewCount: 1 } },
              { session }
            )
          }
        }
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $addToSet: { visitedPlaces: targetId },
        },
        { new: true, session }
      )

      const actualCount = updatedUser?.visitedPlaces ? updatedUser.visitedPlaces.length : 1
      await User.findByIdAndUpdate(
        userId,
        { $set: { visitedPlacesCount: actualCount } },
        { session }
      )

      await session.commitTransaction()
      return {
        isVisited: true,
        visitedCount: actualCount,
        data: newRecord[0],
      }
    }
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
}

const getMyVisitedPlaces = async (
  userId: string,
  query: Record<string, unknown>
) => {
  const { page = 1, limit = 20, sort = '-visitedAt', searchTerm, type } = query
  const skip = (Number(page) - 1) * Number(limit)

  const sortStr = typeof sort === 'string' ? sort : '-visitedAt'
  const sortOrder = sortStr.startsWith('-') ? -1 : 1
  const sortField = sortStr.replace(/^-/, '')

  const matchStage: Record<string, unknown> = {
    user: new mongoose.Types.ObjectId(userId),
  }

  if (type && ['Place', 'Business'].includes(type as string)) {
    matchStage.type = type
  }

  const pipeline: any[] = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'places',
        localField: 'place',
        foreignField: '_id',
        pipeline: [
          {
            $lookup: {
              from: 'categories',
              localField: 'category',
              foreignField: '_id',
              as: 'category',
            },
          },
          { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'maps',
              localField: 'map',
              foreignField: '_id',
              as: 'map',
            },
          },
          { $unwind: { path: '$map', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              name: 1,
              name_es: 1,
              description: 1,
              description_es: 1,
              media: 1,
              type: 1,
              address: 1,
              country: 1,
              location: 1,
              rating: 1,
              totalReview: 1,
              entryCost: 1,
              difficulty: 1,
              category: { name: 1, color: 1, icon: 1 },
              map: { _id: 1, name: 1, country: 1 },
            },
          },
        ],
        as: 'place',
      },
    },
    { $unwind: { path: '$place', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'businesses',
        localField: 'business',
        foreignField: '_id',
        pipeline: [
          {
            $lookup: {
              from: 'categories',
              localField: 'category',
              foreignField: '_id',
              as: 'category',
            },
          },
          { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              name: 1,
              name_es: 1,
              description: 1,
              description_es: 1,
              'media.photos': 1,
              location: 1,
              rating: 1,
              totalReview: 1,
              category: { name: 1, color: 1, icon: 1 },
            },
          },
        ],
        as: 'business',
      },
    },
    { $unwind: { path: '$business', preserveNullAndEmptyArrays: true } },
    {
      $match: {
        $or: [
          { place: { $exists: true, $ne: null } },
          { business: { $exists: true, $ne: null } },
        ],
      },
    },
  ]

  if (typeof query.country === 'string' && query.country.trim()) {
    const { countries, mapIds } = await getCountryScope(query.country)
    pipeline.push({ $match: { $or: [
      { 'place.country': { $in: countries } },
      { 'place.map._id': { $in: mapIds } },
      { 'place.map.country': { $in: countries } },
      { 'place.map.name': { $in: countries } },
      { 'place.map.name.en': { $in: countries } },
      { 'place.map.name.es': { $in: countries } },
      { 'business.location.country': { $in: countries } },
    ] } })
  }

  // Optional search by name or address across place/business
  if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
    const searchRegex = new RegExp(searchTerm.trim(), 'i')
    pipeline.push({
      $match: {
        $or: [
          { 'place.name': searchRegex },
          { 'place.name.en': searchRegex },
          { 'place.name.es': searchRegex },
          { 'place.address': searchRegex },
          { 'business.name': searchRegex },
          { 'business.name.en': searchRegex },
          { 'business.name.es': searchRegex },
        ],
      },
    })
  }

  const limitNum = Number(limit)
  const dataPipeline: any[] = [{ $sort: { [sortField]: sortOrder } }]
  if (skip > 0) {
    dataPipeline.push({ $skip: skip })
  }
  if (limitNum > 0) {
    dataPipeline.push({ $limit: limitNum })
  }

  pipeline.push({
    $facet: {
      data: dataPipeline,
      totalCount: [{ $count: 'count' }],
    },
  })

  const aggregateResult = await Visited.aggregate(pipeline)
  const rawData = aggregateResult[0]?.data || []
  const data = rawData.map((item: any) => ({
    ...item,
    isVisited: true,
  }))
  const total = aggregateResult[0]?.totalCount[0]?.count || 0
  const totalPage = limitNum > 0 ? Math.ceil(total / limitNum) : 1

  return {
    meta: {
      total,
      limit: limitNum > 0 ? limitNum : total,
      page: Number(page),
      totalPage,
    },
    data,
  }
}

const getVisitedCount = async (userId: string) => {
  const user = await User.findById(userId).select('visitedPlacesCount visitedPlaces')
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  const validCountAggregate = await Visited.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId) } },
    {
      $lookup: {
        from: 'places',
        localField: 'place',
        foreignField: '_id',
        as: 'p',
      },
    },
    {
      $lookup: {
        from: 'businesses',
        localField: 'business',
        foreignField: '_id',
        as: 'b',
      },
    },
    {
      $match: {
        $or: [
          { 'p.0': { $exists: true } },
          { 'b.0': { $exists: true } },
        ],
      },
    },
    { $count: 'count' },
  ])

  const count = validCountAggregate[0]?.count || 0
  if (user.visitedPlacesCount !== count) {
    await User.findByIdAndUpdate(userId, { $set: { visitedPlacesCount: count } })
  }
  return { visitedPlacesCount: count }
}

const removeVisited = async (id: string, userId: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'A valid visited record ID is required')
  }

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const result = await Visited.findOneAndDelete({ _id: id, user: userId }).session(session)
    if (!result) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Visited record not found')
    }

    const placeId = result.place || result.business
    if (placeId) {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $pull: { visitedPlaces: placeId } },
        { new: true, session }
      )
      const actualCount = updatedUser?.visitedPlaces ? updatedUser.visitedPlaces.length : 0
      await User.findByIdAndUpdate(
        userId,
        { $set: { visitedPlacesCount: actualCount } },
        { session }
      )
    }

    await session.commitTransaction()
    return result
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
}

export const VisitedService = {
  toggleVisited,
  getMyVisitedPlaces,
  getVisitedCount,
  removeVisited,
}
