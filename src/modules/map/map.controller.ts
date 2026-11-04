import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { MapService } from './map.service'
import { JwtPayload } from 'jsonwebtoken'
import { jwtHelper } from '../../helpers/jwtHelper'
import config from '../../config'
import { Secret } from 'jsonwebtoken'
import { USER_ROLES } from '../../enum/user'
import { getUserFromToken, getAccessibleMapIds, verifyEditorEditAccess } from '../../helpers/mapAccessHelper'
import { Map } from './map.model'
import ApiError from '../../errors/ApiError'
import { localizeDocument } from '../../helpers/localize'

const mapFields = ['name', 'description']

const createMap = catchAsync(async (req: Request, res: Response) => {
  const result = await MapService.createMap(req.body)
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Map created successfully',
    data: localizeDocument(result, req.lang, mapFields),
  })
})

const getManagedMaps = catchAsync(async (req: Request, res: Response) => {
  const user = await getUserFromToken(req.headers.authorization)
  if (!user) throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized.')
  if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You do not have permission to manage maps.')
  }
  const query: Record<string, unknown> = { ...req.query }
  if (user.role === USER_ROLES.MAP_EDITOR) {
    const countries = (user.assignedCountries || []).filter(country => country.trim()).map(country =>
      new RegExp('^' + country.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
    )
    const assigned = await Map.find({ $or: [
      { _id: { $in: user.assignedMaps || [] } },
      { country: { $in: countries } },
      { 'name.en': { $in: countries } },
      { 'name.es': { $in: countries } },
      { name: { $in: countries } },
    ] }).select('_id').lean()
    query._id = { $in: assigned.map(map => map._id) }
  }
  const result = await MapService.getAllMaps(query)
  sendResponse(res, {
    statusCode: StatusCodes.OK, success: true, message: 'Managed maps retrieved successfully',
    meta: result.meta, data: localizeDocument(result.data, req.lang, mapFields),
  })
})

const getAllMaps = catchAsync(async (req: Request, res: Response) => {
  const authorizationHeader = req.headers.authorization
  const user = await getUserFromToken(authorizationHeader)
  const accessibleMapIds = await getAccessibleMapIds(user)

  const isAdminOrEditor = !!(
    user &&
    [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR].includes(
      user.role as any
    )
  )

  const query = { ...req.query }
  if (!isAdminOrEditor) {
    query.isActive = 'true'
    query.status = 'Published'
  }

  const result = await MapService.getAllMaps(query)

  // Tag each map with isLocked (places are NOT populated in list view for performance)
  const data = result.data.map((map: any) => {
    const mapObj = typeof map.toObject === 'function' ? map.toObject() : map
    const isLockedMap = !accessibleMapIds.includes(mapObj._id.toString())
    mapObj.isLocked = isLockedMap
    return mapObj
  })

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Maps retrieved successfully',
    meta: result.meta,
    data: localizeDocument(data, req.lang, mapFields),
  })
})

const getMapById = catchAsync(async (req: Request, res: Response) => {
  const authorizationHeader = req.headers.authorization
  const user = await getUserFromToken(authorizationHeader)
  const accessibleMapIds = await getAccessibleMapIds(user)

  const result = await MapService.getMapById(req.params.id)
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found')
  }

  const isAdminOrEditor = !!(
    user &&
    [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR].includes(
      user.role as any
    )
  )

  if (!isAdminOrEditor && (result.status === 'Draft' || result.isActive === false)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found')
  }

  const mapObj =
    typeof (result as any).toObject === 'function'
      ? (result as any).toObject()
      : { ...result }
  // Access flag for catalog UI; places are loaded via discovery, not nested here
  mapObj.isLocked = !accessibleMapIds.includes(mapObj._id.toString())

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Map retrieved successfully',
    data: localizeDocument(mapObj, req.lang, mapFields),
  })
})

const updateMap = catchAsync(async (req: Request, res: Response) => {
  const user = await getUserFromToken(req.headers.authorization)
  const mapId = req.params.id
  
  await verifyEditorEditAccess(user, mapId)

  const result = await MapService.updateMap(mapId, req.body)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Map updated successfully',
    data: localizeDocument(result, req.lang, mapFields),
  })
})

const deleteMap = catchAsync(async (req: Request, res: Response) => {
  const result = await MapService.deleteMap(req.params.id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Map deleted successfully',
    data: localizeDocument(result, req.lang, mapFields),
  })
})

const purchaseMap = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const result = await MapService.purchaseMap(user.authId, req.params.id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Map purchased successfully',
    data: result,
  })
})

const getPurchasedMaps = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const result = await MapService.getPurchasedMaps(user.authId)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Purchased maps retrieved successfully',
    data: localizeDocument(result, req.lang, mapFields),
  })
})

const incrementViewCount = catchAsync(async (req: Request, res: Response) => {
  const result = await MapService.incrementViewCount(req.params.id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Map view recorded',
    data: { viewCount: (result as any).viewCount || 0 },
  })
})

const getAvailableCountries = catchAsync(async (req: Request, res: Response) => {
  const result = await MapService.getAvailableCountries()
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Available countries retrieved successfully',
    data: result,
  })
})

const getDiscoveryData = catchAsync(async (req: Request, res: Response) => {
  const authorizationHeader = req.headers.authorization
  const user = await getUserFromToken(authorizationHeader)
  const mapIdParam = req.query.map ? String(req.query.map) : undefined

  // Run accessible map IDs, paid maps lookup, and target map lookup in parallel
  const [accessibleMapIds, paidMaps, targetMap] = await Promise.all([
    getAccessibleMapIds(user),
    Map.find(user?.role === USER_ROLES.MAP_EDITOR ? {} : { isPaid: true }, '_id'),
    mapIdParam ? Map.findById(mapIdParam).select('name country').lean() : null,
  ])

  const paidMapIds = paidMaps.map(m => m._id.toString())
  const lockedMapIds = paidMapIds.filter(id => !accessibleMapIds.includes(id))

  const isAdminOrEditor = !!(user && (user.role === 'super_admin' || user.role === 'admin' || user.role === 'map_editor'))
  const result = await MapService.getDiscoveryData(req.query, lockedMapIds, isAdminOrEditor, targetMap,
    user?.role === USER_ROLES.MAP_EDITOR ? accessibleMapIds : undefined)

  const visitedSet = new Set(
    (user?.visitedPlaces || []).map((id: any) => id.toString())
  )

  const isGuest = !user
  const now = Date.now()
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000

  const enrichItem = (item: any) => {
    const isNewlyAdded = Boolean(
      item.createdAt && (now - new Date(item.createdAt).getTime() <= sixtyDaysMs)
    )
    const isLocked = Boolean(item.isLocked)

    // For users without an account, hide the name of newly added locked locations.
    let maskedName = item.name
    if (isGuest && isNewlyAdded && isLocked) {
      maskedName = {
        en: 'A location was added to the map...',
        es: 'Se agregó una ubicación al mapa...',
      }
    }

    return {
      ...item,
      name: maskedName,
      isNewlyAdded,
      isVisited: visitedSet.has(item._id?.toString()),
    }
  }
  const itemsWithVisited = { ...result, data: result.data.map(enrichItem) }

  const discoveryFields = ['name', 'description', 'access', 'entryCost', 'hikeTime', 'atmosphere', 'accessibility.notes', 'recommendations.tips', 'category.name']

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Discovery data retrieved successfully',
    data: localizeDocument(itemsWithVisited, req.lang, discoveryFields),
  })
})

export const MapController = {
  getManagedMaps,
  createMap,
  getAllMaps,
  getMapById,
  updateMap,
  deleteMap,
  purchaseMap,
  getPurchasedMaps,
  incrementViewCount,
  getAvailableCountries,
  getDiscoveryData,
}
