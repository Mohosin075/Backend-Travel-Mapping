import { Request, Response } from 'express'
import { ReviewService } from './review.service'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { StatusCodes } from 'http-status-codes'
import { paginationFields } from '../../interfaces/pagination'
import pick from '../../shared/pick'
import { JwtPayload } from 'jsonwebtoken'
import { getUserFromToken } from '../../helpers/mapAccessHelper'
import { localizeDocument } from '../../helpers/localize'

const reviewFields = [
  'review',
  'placeId.name',
  'placeId.description',
  'businessId.name',
  'businessId.description',
]

const createReview = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.createReview(req.user!, req.body)

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Review created successfully',
    data: localizeDocument(result, req.lang, reviewFields),
  })
})

const updateReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await ReviewService.updateReview(req.user!, id, req.body)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Review updated successfully',
    data: localizeDocument(result, req.lang, reviewFields),
  })
})

const getAllReviews = catchAsync(async (req: Request, res: Response) => {
  const paginationOptions = pick(req.query, paginationFields)
  
  // Extract filters: placeId, businessId, reviewer, status
  const filter = pick(req.query, ['placeId', 'businessId', 'reviewer', 'status'])
  
  // Enforce Approved reviews only for regular users if status filter isn't explicitly checked/allowed
  const user = req.user as any
  const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin')
  if (!isAdmin && !filter.status) {
    filter.status = 'Approved'
  }

  const result = await ReviewService.getAllReviews(paginationOptions, filter, req.user)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Reviews retrieved successfully',
    data: localizeDocument(result, req.lang, reviewFields),
  })
})

const getReviewsByPlace = catchAsync(async (req: Request, res: Response) => {
  const { placeId } = req.params
  const user = await getUserFromToken(req.headers.authorization)
  const paginationOptions = pick(req.query, paginationFields)
  const result = await ReviewService.getReviewsByPlace(
    placeId,
    paginationOptions,
    user?._id?.toString(),
    user?.role,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Reviews retrieved successfully',
    data: localizeDocument(result, req.lang, reviewFields),
  })
})

const getReviewsByBusiness = catchAsync(async (req: Request, res: Response) => {
  const { businessId } = req.params
  const user = await getUserFromToken(req.headers.authorization)
  const paginationOptions = pick(req.query, paginationFields)
  const result = await ReviewService.getReviewsByBusiness(
    businessId,
    paginationOptions,
    user?._id?.toString(),
    user?.role,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Reviews retrieved successfully',
    data: localizeDocument(result, req.lang, reviewFields),
  })
})

const deleteReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await ReviewService.deleteReview(req.user!, id)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Review deleted successfully',
    data: result,
  })
})

const getSingleReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await ReviewService.getSingleReview(id, req.user)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Review retrieved successfully',
    data: localizeDocument(result, req.lang, reviewFields),
  })
})

const getMyReviews = catchAsync(async (req: Request, res: Response) => {
  const paginationOptions = pick(req.query, paginationFields)
  const result = await ReviewService.getMyReviews(req.user!, paginationOptions)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'My reviews retrieved successfully',
    data: localizeDocument(result, req.lang, reviewFields),
  })
})

const approveReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await ReviewService.approveReview(id)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Review approved successfully',
    data: result,
  })
})

const rejectReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await ReviewService.rejectReview(id)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Review rejected successfully',
    data: result,
  })
})

export const ReviewController = {
  createReview,
  updateReview,
  getAllReviews,
  deleteReview,
  getSingleReview,
  getReviewsByPlace,
  getReviewsByBusiness,
  getMyReviews,
  approveReview,
  rejectReview,
}
