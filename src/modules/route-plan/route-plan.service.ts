import { StatusCodes } from 'http-status-codes'
import mongoose from 'mongoose'
import ApiError from '../../errors/ApiError'
import { IRoutePlan, IRouteStop } from './route-plan.interface'
import { RoutePlan } from './route-plan.model'
import { Place } from '../place/place.model'
import { Business } from '../business/business.model'
import { User } from '../user/user.model'
import { Map } from '../map/map.model'

/**
 * Normalizes stops before saving:
 * - Checks whether ID belongs to Place or Business
 * - Preserves existing subdocument _id if present
 * - Ensures valid order index
 * - Restricts tourist attractions to purchased/free maps for normal users
 */
const normalizeStops = async (
  rawStops: any[],
  userId?: string
): Promise<IRouteStop[]> => {
  if (!Array.isArray(rawStops)) return []

  let userRole: string | undefined
  let purchasedMaps: string[] = []

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    const userDoc = await User.findById(userId).select('role purchasedMaps')
    if (userDoc) {
      userRole = userDoc.role
      purchasedMaps = (userDoc.purchasedMaps || []).map((m: any) => m.toString())
    }
  }

  const isAdminOrEditor = ['super_admin', 'admin', 'map_editor'].includes(
    userRole || ''
  )

  const formattedStops: IRouteStop[] = []

  for (let index = 0; index < rawStops.length; index++) {
    const item = rawStops[index]
    const targetId = item.place || item.business || item.placeId || item.id

    if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
      continue
    }

    let type: 'Place' | 'Business' = item.type || 'Place'
    let placeId: mongoose.Types.ObjectId | undefined = undefined
    let businessId: mongoose.Types.ObjectId | undefined = undefined

    // Verify existence in Place or Business collections
    const placeDoc = await Place.findById(targetId).select('_id type map')
    if (placeDoc) {
      placeId = placeDoc._id
      type = placeDoc.type === 'Business' ? 'Business' : 'Place'

      // Restrict tourist attractions: non-business places require purchased or free map
      if (type === 'Place' && !isAdminOrEditor) {
        if (placeDoc.map) {
          const mapDoc = await Map.findById(placeDoc.map).select('isPaid')
          const isPaid = mapDoc ? mapDoc.isPaid !== false : true
          const hasPurchased = purchasedMaps.includes(placeDoc.map.toString())
          if (isPaid && !hasPurchased) {
            throw new ApiError(
              StatusCodes.FORBIDDEN,
              'Restricted tourist attraction. You must purchase the corresponding map to add this place to your route plan.'
            )
          }
        }
      }
    } else {
      const businessDoc = await Business.findById(targetId).select('_id')
      if (businessDoc) {
        businessId = businessDoc._id
        type = 'Business'
      } else {
        // Fallback: keep targetId as place reference
        placeId = new mongoose.Types.ObjectId(targetId)
      }
    }

    const stopObj: IRouteStop = {
      place: placeId,
      business: businessId,
      type,
      order: typeof item.order === 'number' ? item.order : index + 1,
      note: item.note || '',
    }

    // Preserve existing subdocument _id if valid
    if (item._id && mongoose.Types.ObjectId.isValid(item._id)) {
      stopObj._id = new mongoose.Types.ObjectId(item._id)
    }

    formattedStops.push(stopObj)
  }

  // Sort by order ascending
  formattedStops.sort((a, b) => a.order - b.order)
  return formattedStops
}

const populateRoutePlan = (query: any) => {
  return query
    .populate({
      path: 'stops.place',
      select:
        'name media address location category type rating totalReview country access entryCost',
      populate: {
        path: 'category',
        select: 'name icon',
      },
    })
    .populate({
      path: 'stops.business',
      select: 'name media location category contact',
      populate: {
        path: 'category',
        select: 'name icon',
      },
    })
}

const createRoutePlan = async (
  userId: string,
  payload: {
    name: string
    description?: string
    stops?: any[]
    isPublic?: boolean
  }
): Promise<IRoutePlan> => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID')
  }

  const stops = payload.stops ? await normalizeStops(payload.stops, userId) : []

  const newRoute = await RoutePlan.create({
    user: new mongoose.Types.ObjectId(userId),
    name: payload.name || 'Mi Roadtrip',
    description: payload.description || '',
    stops,
    isPublic: payload.isPublic ?? false,
  })

  const populated = await populateRoutePlan(RoutePlan.findById(newRoute._id))
  return populated
}

const getMyRoutePlans = async (
  userId: string,
  query: Record<string, unknown>
) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid User ID')
  }

  const { page = 1, limit = 20, sort = '-updatedAt', searchTerm } = query
  const skip = (Number(page) - 1) * Number(limit)

  const filter: Record<string, any> = {
    user: new mongoose.Types.ObjectId(userId),
  }

  if (searchTerm && typeof searchTerm === 'string') {
    filter.name = { $regex: searchTerm.trim(), $options: 'i' }
  }

  const [data, total] = await Promise.all([
    populateRoutePlan(
      RoutePlan.find(filter)
        .sort(sort as string)
        .skip(skip)
        .limit(Number(limit))
    ).lean(),
    RoutePlan.countDocuments(filter),
  ])

  // Ensure stops inside each route are sorted by order
  data.forEach((route: any) => {
    if (Array.isArray(route.stops)) {
      route.stops.sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
    }
  })

  const totalPage = Math.ceil(total / Number(limit))

  return {
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPage,
    },
    data,
  }
}

const getRoutePlanById = async (
  id: string,
  userId: string,
  userRole?: string
): Promise<IRoutePlan> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Route ID')
  }

  const routePlan = await populateRoutePlan(RoutePlan.findById(id))

  if (!routePlan) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Route plan not found')
  }

  const isOwner = routePlan.user.toString() === userId
  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

  // Allow access if owner, public, or admin
  if (!isOwner && !routePlan.isPublic && !isAdmin) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'You do not have permission to view this route plan'
    )
  }

  if (Array.isArray(routePlan.stops)) {
    routePlan.stops.sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
  }

  return routePlan
}

const updateRoutePlan = async (
  id: string,
  userId: string,
  payload: {
    name?: string
    description?: string
    stops?: any[]
    isPublic?: boolean
  }
): Promise<IRoutePlan> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Route ID')
  }

  const existingRoute = await RoutePlan.findOne({
    _id: id,
    user: userId,
  })

  if (!existingRoute) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Route plan not found or you are not authorized to update it'
    )
  }

  const updateFields: Record<string, any> = {}

  if (payload.name !== undefined) updateFields.name = payload.name
  if (payload.description !== undefined)
    updateFields.description = payload.description
  if (payload.isPublic !== undefined) updateFields.isPublic = payload.isPublic
  if (payload.stops !== undefined) {
    updateFields.stops = await normalizeStops(payload.stops, userId)
  }

  const updated = await populateRoutePlan(
    RoutePlan.findByIdAndUpdate(id, { $set: updateFields }, { new: true })
  )

  if (updated && Array.isArray(updated.stops)) {
    updated.stops.sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
  }

  return updated
}

const deleteRoutePlan = async (
  id: string,
  userId: string
): Promise<IRoutePlan | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Route ID')
  }

  const result = await RoutePlan.findOneAndDelete({
    _id: id,
    user: userId,
  })

  if (!result) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Route plan not found or already deleted'
    )
  }

  return result
}

const clearRouteStops = async (
  id: string,
  userId: string
): Promise<IRoutePlan | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Route ID')
  }

  const result = await RoutePlan.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: { stops: [] } },
    { new: true }
  )

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Route plan not found')
  }

  return result
}

const addStop = async (
  id: string,
  userId: string,
  stopData: any
): Promise<IRoutePlan> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Route ID')
  }

  const routePlan = await RoutePlan.findOne({ _id: id, user: userId })
  if (!routePlan) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Route plan not found')
  }

  const normalized = await normalizeStops(
    [
      {
        ...stopData,
        order:
          typeof stopData.order === 'number'
            ? stopData.order
            : routePlan.stops.length + 1,
      },
    ],
    userId
  )

  if (!normalized.length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid place ID')
  }

  routePlan.stops.push(normalized[0] as any)
  routePlan.stops.sort((a, b) => a.order - b.order)
  await routePlan.save()

  const populated = await populateRoutePlan(RoutePlan.findById(routePlan._id))
  return populated
}

const removeStop = async (
  id: string,
  stopId: string,
  userId: string
): Promise<IRoutePlan> => {
  if (
    !mongoose.Types.ObjectId.isValid(id) ||
    !mongoose.Types.ObjectId.isValid(stopId)
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid ID')
  }

  const routePlan = await RoutePlan.findOne({ _id: id, user: userId })
  if (!routePlan) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Route plan not found')
  }

  // Supports removing by subdoc _id, place id, or business id
  routePlan.stops = routePlan.stops.filter((s: any) => {
    const subdocId = s._id?.toString()
    const placeRef = s.place?._id ? s.place._id.toString() : s.place?.toString()
    const businessRef = s.business?._id
      ? s.business._id.toString()
      : s.business?.toString()

    return (
      subdocId !== stopId && placeRef !== stopId && businessRef !== stopId
    )
  }) as any

  // Re-index remaining stops sequentially: 1, 2, 3...
  routePlan.stops.forEach((s, idx) => {
    s.order = idx + 1
  })

  await routePlan.save()
  const populated = await populateRoutePlan(RoutePlan.findById(routePlan._id))
  return populated
}

export const RoutePlanService = {
  createRoutePlan,
  getMyRoutePlans,
  getRoutePlanById,
  updateRoutePlan,
  deleteRoutePlan,
  clearRouteStops,
  addStop,
  removeStop,
}
