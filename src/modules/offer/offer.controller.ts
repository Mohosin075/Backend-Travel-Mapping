import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { OfferService } from './offer.service'
import { JwtPayload } from 'jsonwebtoken'
import { localizeDocument } from '../../helpers/localize'

const offerFields = ['title', 'description', 'buttonLabel', 'place.name', 'business.name']

const createOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await OfferService.createOffer(req.body, req.headers.authorization)
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Offer created successfully',
    data: localizeDocument(result, req.lang, offerFields),
  })
})

const getAllOffers = catchAsync(async (req: Request, res: Response) => {
  const result = await OfferService.getAllOffers(req.query, req.headers.authorization)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Offers retrieved successfully',
    meta: result.meta,
    data: localizeDocument(result.data, req.lang, offerFields),
  })
})

const getOfferById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await OfferService.getOfferById(id, req.headers.authorization)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Offer retrieved successfully',
    data: localizeDocument(result, req.lang, offerFields),
  })
})

const updateOffer = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await OfferService.updateOffer(id, req.body, req.headers.authorization)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Offer updated successfully',
    data: localizeDocument(result, req.lang, offerFields),
  })
})

const getOffersByPlaceOrBusinessId = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await OfferService.getOffersByPlaceOrBusinessId(id, req.headers.authorization)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Offers retrieved successfully',
    data: localizeDocument(result, req.lang, offerFields),
  })
})

const deleteOffer = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await OfferService.deleteOffer(id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Offer deleted successfully',
    data: result,
  })
})

const calculateDiscount = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const { price } = req.body
  const result = await OfferService.calculateDiscount(id, Number(price), req.headers.authorization)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Discount calculated successfully',
    data: result,
  })
})

const redeemOffer = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const { authId } = req.user as JwtPayload
  const result = await OfferService.redeemOffer(id, authId, req.headers.authorization)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Offer redeemed successfully',
    data: result,
  })
})

const getOfferRedemptions = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const timeFilter = req.query.timeFilter as string | undefined
  const result = await OfferService.getOfferRedemptions(
    id,
    req.headers.authorization,
    timeFilter,
  )
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Offer redemptions retrieved successfully',
    data: result,
  })
})

export const OfferController = {
  createOffer,
  getAllOffers,
  getManagedOffers: catchAsync(async (req: Request, res: Response) => {
    const result = await OfferService.getManagedOffers(req.query, req.headers.authorization)
    sendResponse(res, {
      statusCode: StatusCodes.OK, success: true, message: 'Managed offers retrieved successfully',
      meta: result.meta, data: localizeDocument(result.data, req.lang, offerFields),
    })
  }),
  getOfferById,
  updateOffer,
  deleteOffer,
  calculateDiscount,
  redeemOffer,
  getOffersByPlaceOrBusinessId,
  getOfferRedemptions,
}

