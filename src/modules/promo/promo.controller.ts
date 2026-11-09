import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { JwtPayload } from 'jsonwebtoken'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { PromoServices } from './promo.service'
import { localizeDocument } from '../../helpers/localize'

const promoFields = ['mapId.name']

const verifyPromoPayment = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const result = await PromoServices.verifyPromoPayment(user.authId, req.body.code, req.body.sessionId)
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Promo payment verified', data: result })
})

const verifyPromoCode = catchAsync(async (req: Request, res: Response) => {
  const { code, mapId } = req.query as { code?: string; mapId?: string }
  if (!code) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: 'Code query parameter is required',
    })
  }

  const result = await PromoServices.verifyPromoCode(code, mapId)
  const { checkoutReservationId, checkoutUserId, checkoutMapId, checkoutExpiresAt, checkoutSessionId, checkoutReturnOrigin, ...publicPromo } = result
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promo link is valid',
    data: publicPromo,
  })
})

const claimFreePromo = catchAsync(async (req: Request, res: Response) => {
  const { code, mapId } = req.body
  const user = req.user as JwtPayload
  const userId = user?.authId // Get authenticated user ID from req.user
  if (!userId) {
    return sendResponse(res, {
      statusCode: StatusCodes.UNAUTHORIZED,
      success: false,
      message: 'User authentication credentials not found',
    })
  }

  const result = await PromoServices.claimFreePromo(userId, code, mapId)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: { mapId: result.mapId, mapName: result.mapName },
  })
})

const createPromoCheckoutSession = catchAsync(
  async (req: Request, res: Response) => {
    const { code, mapId } = req.body
    const user = req.user as JwtPayload
    if (!user) {
      return sendResponse(res, {
        statusCode: StatusCodes.UNAUTHORIZED,
        success: false,
        message: 'User credentials not found',
      })
    }

    const result = await PromoServices.createPromoCheckoutSession(
      user,
      code,
      mapId,
      req.headers.origin,
    )
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Promo checkout session created successfully',
      data: result,
    })
  },
)

const bulkGeneratePromoLinks = catchAsync(
  async (req: Request, res: Response) => {
    const result = await PromoServices.bulkGeneratePromoLinks(req.body)
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: 'Promo links generated successfully',
      data: result,
    })
  },
)

const sendBulkPromoEmails = catchAsync(async (req: Request, res: Response) => {
  const { promoIds } = req.body
  const result = await PromoServices.sendBulkPromoEmails(promoIds)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
  })
})

const getAllPromoLinks = catchAsync(async (req: Request, res: Response) => {
  const result = await PromoServices.getAllPromoLinks(req.query)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promo links retrieved successfully',
    meta: result.meta,
    data: localizeDocument(result.data, req.lang, promoFields),
  })
})

const deletePromoLink = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await PromoServices.deletePromoLink(id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promo link deleted successfully',
    data: result,
  })
})

const getPromoStats = catchAsync(async (req: Request, res: Response) => {
  const result = await PromoServices.getPromoStats()
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promo stats retrieved successfully',
    data: result,
  })
})

export const PromoControllers = {
  verifyPromoPayment,
  verifyPromoCode,
  claimFreePromo,
  createPromoCheckoutSession,
  bulkGeneratePromoLinks,
  sendBulkPromoEmails,
  getAllPromoLinks,
  deletePromoLink,
  getPromoStats,
}
