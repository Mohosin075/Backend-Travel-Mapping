import { Request, Response } from 'express'

import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'

import { UserServices } from './user.service'
import pick from '../../shared/pick'
import { paginationFields } from '../../interfaces/pagination'
import { JwtPayload } from 'jsonwebtoken'
import ApiError from '../../errors/ApiError'
import { userFilterableFields } from './user.constants'
import { IUser } from './user.interface'

const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const { images, ...userData } = req.body

  if (images) {
    userData.profile = Array.isArray(images) ? images[0] : images
  }
  const result = await UserServices.updateProfile(req.user!, userData)
  sendResponse<string>(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Profile updated successfully',
    data: result,
  })
})

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const paginationOptions = pick(req.query, paginationFields)
  const filterables = pick(req.query, userFilterableFields)
  const result = await UserServices.getAllUsers(paginationOptions, filterables)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Users retrieved successfully',
    meta: result.meta,
    data: result.data,
  })
})

const deleteUser = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params
  const result = await UserServices.deleteUser(userId, req.user)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User deleted successfully',
    data: result,
  })
})

const deleteProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const { password } = req.body

  if (!password) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is required')
  }

  const result = await UserServices.deleteProfile(user.authId, password)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User profile deleted successfully',
    data: result,
  })
})

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params
  const result = await UserServices.getUserById(userId)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User retrieved successfully',
    data: result,
  })
})

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params
  const { status } = req.body
  if (!status) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Status is required')
  }
  const result = await UserServices.updateUserStatus(userId, status, req.user)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User status updated successfully',
    data: result,
  })
})

const updateUserRole = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params
  const { role, assignedMaps, assignedCountries } = req.body
  if (!role) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Role is required')
  }
  const result = await UserServices.updateUserRole(
    userId,
    role,
    assignedMaps,
    assignedCountries,
    req.user,
  )
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User role updated successfully',
    data: result,
  })
})

const inviteUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.inviteUser(req.body, req.user)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result,
  })
})

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.getProfile(req.user!)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User profile retrieved successfully',
    data: result,
  })
})

const getPublicProfile = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params
  const result = await UserServices.getPublicProfile(userId)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Public profile retrieved successfully',
    data: result,
  })
})

const addUserInterest = catchAsync(async (req: Request, res: Response) => {
  const { authId } = req.user as JwtPayload
  const { interest } = req.body
  const result = await UserServices.addUserInterest(authId, interest)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User interest updated successfully',
    data: result,
  })
})

const toggleFavoriteMap = catchAsync(async (req: Request, res: Response) => {
  const { authId } = req.user as JwtPayload
  const { mapId } = req.params
  const result = await UserServices.toggleFavoriteMap(authId, mapId)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Toggle favorite map successfully',
    data: result,
  })
})

const getFavoriteMaps = catchAsync(async (req: Request, res: Response) => {
  const { authId } = req.user as JwtPayload
  const result = await UserServices.getFavoriteMaps(authId)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Favorite maps retrieved successfully',
    data: result,
  })
})

const toggleFavoriteOffer = catchAsync(async (req: Request, res: Response) => {
  const { authId } = req.user as JwtPayload
  const { offerId } = req.params
  const result = await UserServices.toggleFavoriteOffer(authId, offerId)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result,
    data: result,
  })
})

const getFavoriteOffers = catchAsync(async (req: Request, res: Response) => {
  const { authId } = req.user as JwtPayload
  const result = await UserServices.getFavoriteOffers(authId)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Favorite offers retrieved successfully',
    data: result,
  })
})

const assignEditorAccess = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params
  const { assignedMaps, assignedCountries } = req.body

  const result = await UserServices.assignEditorAccess(userId, assignedMaps, assignedCountries)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Editor access assigned successfully',
    data: result,
  })
})

const updateUserMapAccess = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params
  const { mapId, action } = req.body

  const result = await UserServices.updateUserMapAccess(
    userId,
    mapId,
    action,
    req.user,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.user,
  })
})

export const UserController = {
  updateProfile,
  getAllUsers,
  deleteUser,
  getUserById,
  updateUserStatus,
  updateUserRole,
  inviteUser,
  getProfile,
  getPublicProfile,
  deleteProfile,
  addUserInterest,
  toggleFavoriteMap,
  getFavoriteMaps,
  toggleFavoriteOffer,
  getFavoriteOffers,
  assignEditorAccess,
  updateUserMapAccess,
}
