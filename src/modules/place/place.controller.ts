import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { PlaceService } from './place.service'
import { getUserFromToken, getAccessibleMapIds, verifyEditorEditAccess } from '../../helpers/mapAccessHelper'
import { Map } from '../map/map.model'
import ApiError from '../../errors/ApiError'
import { getCoordinatesFromUrl } from '../../utils/mapHelper'
import { USER_ROLES } from '../../enum/user'
import { toStringArray } from '../../utils/media'
import { localizeDocument } from '../../helpers/localize'
import pick from '../../shared/pick'
import { JwtPayload } from 'jsonwebtoken'

const placeFields = ['name', 'description', 'access', 'entryCost', 'hikeTime', 'atmosphere', 'accessibility.notes', 'recommendations.tips', 'category.name']

const createPlace = catchAsync(async (req: Request, res: Response) => {
  const user = await getUserFromToken(req.headers.authorization)
  
  // A place must belong to a map, verify access
  if (req.body.map) {
    await verifyEditorEditAccess(user, req.body.map)
  }

  const uploadedImages = toStringArray(req.body.images)
  const uploadedDocs = toStringArray(req.body.documents)
  if (uploadedImages.length || req.body.media) {
    req.body.media = [
      ...toStringArray(req.body.media),
      ...uploadedImages,
    ]
  }
  if (uploadedDocs.length || req.body.menuImages) {
    req.body.menuImages = [
      ...toStringArray(req.body.menuImages),
      ...uploadedDocs,
    ]
  }
  const result = await PlaceService.createPlace(req.body)
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Place created successfully',
    data: localizeDocument(result, req.lang, placeFields),
  })
})

const getAllPlaces = catchAsync(async (req: Request, res: Response) => {
  const authorizationHeader = req.headers.authorization

  // Run auth lookup and paid map IDs in parallel to avoid sequential DB hits
  const [user, paidMaps] = await Promise.all([
    getUserFromToken(authorizationHeader),
    Map.find({ isPaid: true }, '_id'),
  ])
  const accessibleMapIds = await getAccessibleMapIds(user)

  const paidMapIds = paidMaps.map(m => m._id.toString())
  const lockedMapIds = paidMapIds.filter(id => !accessibleMapIds.includes(id))

  const isPremium = !!(user && [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role as any))

  const result = await PlaceService.getAllPlaces(req.query, isPremium, accessibleMapIds)

  const visitedSet = new Set(
    (user?.visitedPlaces || []).map((id: any) => id.toString())
  )

  const updatedData = result.data.map((place: any) => {
    const mapId = place.map?._id || place.map
    const isLocked = !isPremium && mapId && lockedMapIds.includes(mapId.toString()) && place.type !== 'Business'
    const isVisited = visitedSet.has(place._id.toString())
    if (isLocked) {
      // Keep teaser fields (name/media/category/location) for locked cards
      const { description, hours, privateInfo, ...teaser } = place
      return {
        ...teaser,
        description: undefined,
        hours: undefined,
        privateInfo: undefined,
        isLocked: true,
        isVisited,
      }
    }
    return {
      ...place,
      isLocked: false,
      isVisited,
    }
  })

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Places retrieved successfully',
    meta: result.meta,
    data: localizeDocument(updatedData, req.lang, placeFields),
  })
})

const getPlaceById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await PlaceService.getPlaceById(id)
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
  }

  const authorizationHeader = req.headers.authorization
  const user = await getUserFromToken(authorizationHeader)

  const isPremium = !!(user && [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role as any))

  if (!isPremium && (result.status === 'Draft' || result.status === 'Pending')) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
  }

  const accessibleMapIds = await getAccessibleMapIds(user)

  const mapId = result.map?._id || result.map
  if (mapId) {
    const isLocked = !accessibleMapIds.includes(mapId.toString())
    if (!isPremium && isLocked) {
      if (result.type !== 'Business') {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          'This information and these benefits can be unlocked by purchasing your favorite map.'
        )
      }
    }
  }

  const placeObj = typeof (result as any).toObject === 'function' ? (result as any).toObject() : result
  const isLocked = mapId && !accessibleMapIds.includes(mapId.toString()) && result.type !== 'Business'
  placeObj.isLocked = !isPremium && !!isLocked
  placeObj.isVisited = !!(user && (user.visitedPlaces || []).some((vId: any) => vId.toString() === result._id.toString()))

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Place retrieved successfully',
    data: localizeDocument(placeObj, req.lang, placeFields),
  })
})

const updatePlace = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = await getUserFromToken(req.headers.authorization)
  
  const existingPlace = await PlaceService.getPlaceById(id)
  if (!existingPlace) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
  }

  // A place must belong to a map, verify access to the existing map
  const mapId = existingPlace.map?._id || existingPlace.map
  if (mapId) {
    await verifyEditorEditAccess(user, mapId.toString())
  }
  
  // If they are moving the place to a new map, verify access to the new map too
  if (req.body.map && req.body.map !== mapId?.toString()) {
    await verifyEditorEditAccess(user, req.body.map)
  }

  const uploadedImages = toStringArray(req.body.images)
  const uploadedDocs = toStringArray(req.body.documents)
  if (uploadedImages.length || req.body.media) {
    req.body.media = [
      ...toStringArray(req.body.media),
      ...uploadedImages,
    ]
  }
  if (uploadedDocs.length || req.body.menuImages) {
    req.body.menuImages = [
      ...toStringArray(req.body.menuImages),
      ...uploadedDocs,
    ]
  }
  const result = await PlaceService.updatePlace(id, req.body)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Place updated successfully',
    data: localizeDocument(result, req.lang, placeFields),
  })
})

const deletePlace = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await PlaceService.deletePlace(id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Place deleted successfully',
    data: result,
  })
})

const incrementOpenCount = catchAsync(async (req: Request, res: Response) => {
  const result = await PlaceService.incrementOpenCount(req.params.id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Place view recorded',
    data: { openCount: (result as any).openCount || 0 },
  })
})

const extractCoordinates = catchAsync(async (req: Request, res: Response) => {
  const { url } = req.body
  if (!url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Google Maps URL is required')
  }

  const coordinates = await getCoordinatesFromUrl(url)
  if (!coordinates) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Could not extract coordinates. Try using the full URL from your browser address bar.'
    )
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Coordinates extracted successfully',
    data: coordinates,
  })
})

const recommendPlace = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication required')
  }

  const uploadedImages = toStringArray(req.body.images)
  const uploadedDocs = toStringArray(req.body.documents)
  if (uploadedImages.length || req.body.media) {
    req.body.media = [
      ...toStringArray(req.body.media),
      ...uploadedImages,
    ]
  }
  if (uploadedDocs.length || req.body.menuImages) {
    req.body.menuImages = [
      ...toStringArray(req.body.menuImages),
      ...uploadedDocs,
    ]
  }

  const result = await PlaceService.recommendPlace(user, req.body)
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Tourist spot recommended successfully. It will be reviewed by our team.',
    data: localizeDocument(result, req.lang, placeFields),
  })
})

const reviewRecommendedPlace = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await PlaceService.reviewRecommendedPlace(id, req.body)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Tourist spot recommendation ${req.body.status.toLowerCase()} successfully`,
    data: localizeDocument(result, req.lang, placeFields),
  })
})

const getMyRecommendations = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication required')
  }

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const status = typeof req.query.status === 'string' ? req.query.status : undefined

  const userId = user.authId || (user as any)._id || (user as any).id
  const result = await PlaceService.getMyRecommendations(
    userId,
    paginationOptions,
    status
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User recommendations retrieved successfully',
    meta: result.meta,
    data: localizeDocument(result.data, req.lang, placeFields),
  })
})

export const PlaceController = {
  createPlace,
  getAllPlaces,
  getPlaceById,
  updatePlace,
  deletePlace,
  incrementOpenCount,
  extractCoordinates,
  recommendPlace,
  reviewRecommendedPlace,
  getMyRecommendations,
}
