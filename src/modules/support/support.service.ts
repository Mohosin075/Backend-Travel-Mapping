import { StatusCodes } from 'http-status-codes'
import ApiError from '../../errors/ApiError'
import { ISupportFilterables, ISupport } from './support.interface'
import { Support } from './support.model'
import { JwtPayload } from 'jsonwebtoken'
import { IPaginationOptions } from '../../interfaces/pagination'
import { paginationHelper } from '../../helpers/paginationHelper'
import { Types } from 'mongoose'
import { SUPPORT_STATUS } from '../../enum/support'
import { User } from '../user/user.model'
import { USER_ROLES, USER_STATUS } from '../../enum/user'

const createSupport = async (
  user: JwtPayload,
  payload: ISupport,
): Promise<ISupport> => {

  const data = {
    ...payload,
    userId: user?.authId,
    status: SUPPORT_STATUS.IN_PROGRESS,
  }

  try {
    const result = await Support.create(data)
    if (!result) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Failed to create Support, please try again with valid data.',
      )
    }

    const superAdmin = await User.findOne({
      role: USER_ROLES.SUPER_ADMIN,
      status: USER_STATUS.ACTIVE,
    }).select('_id email')

    return result
  } catch (error: any) {
    if (error.code === 11000) {
      throw new ApiError(StatusCodes.CONFLICT, 'Duplicate entry found')
    }
    throw error
  }
}

const getAllSupports = async (
  user: JwtPayload,
  filterables: ISupportFilterables,
  pagination: IPaginationOptions,
) => {
  const { page, skip, limit, sortBy, sortOrder } =
    paginationHelper.calculatePagination(pagination)

  const [result, total] = await Promise.all([
    Support.find({ status: { $nin: [SUPPORT_STATUS.DELETED] } })
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder })
      .populate({ path: 'userId', select: 'email name' }),
    Support.countDocuments({ status: { $nin: [SUPPORT_STATUS.DELETED] } }),
  ])

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: result,
  }
}

const getSingleSupport = async (id: string): Promise<ISupport> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Support ID')
  }

  const result = await Support.findById(id).populate({
    path: 'userId',
    select: 'email name',
  })
  if (!result) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Requested support not found, please try again with valid id',
    )
  }

  return result
}

const updateSupport = async (
  id: string,
  payload: Partial<ISupport>,
): Promise<ISupport | null> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Support ID')
  }

  const isSupportExist = await Support.findOne({
    _id: id,
    status: { $nin: [SUPPORT_STATUS.DELETED] },
  })

  if (!isSupportExist) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Requested support not found, please try again with valid id',
    )
  }

  const result = await Support.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true },
  ).populate('userId')

  if (!result) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Requested support not found, please try again with valid id',
    )
  }

  return result
}

const deleteSupport = async (id: string): Promise<ISupport> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Support ID')
  }

  const isSupportExist = await Support.findOne({
    _id: id,
    status: { $nin: [SUPPORT_STATUS.DELETED] },
  })
  if (!isSupportExist) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Requested support not found, please try again with valid id',
    )
  }

  const result = await Support.findByIdAndUpdate(
    id,
    { $set: { status: SUPPORT_STATUS.DELETED } },
    { new: true },
  )
  if (!result) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Something went wrong while deleting support, please try again with valid id.',
    )
  }

  return result
}

export const SupportServices = {
  createSupport,
  getAllSupports,
  getSingleSupport,
  updateSupport,
  deleteSupport,
}
