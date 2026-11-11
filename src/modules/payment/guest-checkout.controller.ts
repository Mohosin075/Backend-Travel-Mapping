import { createHash } from 'crypto'
import { z } from 'zod'
import { StatusCodes } from 'http-status-codes'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { USER_ROLES, USER_STATUS } from '../../enum/user'
import { User } from '../user/user.model'
import { Map } from '../map/map.model'
import { AuthHelper } from '../auth/auth.helper'
import { GuestCheckout } from './guest-checkout.model'
import { Payment } from './payment.model'
import { PaymentServices } from './payment.service'
import stripe from '../../config/stripe'
import { getCheckoutReturnOrigin as getReturnOrigin } from '../../helpers/checkoutOrigin'

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/)
const startSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  mapId: z.string().regex(/^[a-f0-9]{24}$/i).transform(value => value.toLowerCase()),
  checkoutToken: tokenSchema,
})
const completeSchema = z.object({ checkoutToken: tokenSchema, sessionId: z.string().regex(/^cs_[a-zA-Z0-9_]+$/).max(255) })
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const loginRequired = (res: any) => sendResponse(res, {
  statusCode: StatusCodes.OK, success: true,
  message: 'Please sign in or verify your email to continue.', data: { loginRequired: true },
})

const start = catchAsync(async (req, res) => {
  const payload = startSchema.parse(req.body)
  // Browser Origin is checked against server configuration, never a body URL
  // or forwarded Host. Preserve it so Stripe returns to the same browser storage.
  const returnOrigin = getReturnOrigin(req.headers?.origin)
  // Do not accept new guest purchases until the uniqueness indexes are ready.
  await Promise.all([GuestCheckout.init(), Payment.init()])
  const tokenHash = hash(payload.checkoutToken)
  const map = await Map.findById(payload.mapId)
  if (!map || map.status !== 'Published' || !map.isActive || !map.isPaid || !map.price || map.price <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This map is not available for purchase.')
  }

  const attempt = await GuestCheckout.findOne({ tokenHash })
  // New purchases require normal registration/login. Keep only the resume path
  // for capabilities issued before the rollback, including interrupted creation.
  if (!attempt) return loginRequired(res)
  if (attempt.returnOrigin && attempt.returnOrigin !== returnOrigin) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Resume checkout on the website where it was started, or sign in to recover your purchase.')
  }
  if (attempt.email !== payload.email || String(attempt.mapId) !== payload.mapId ||
      attempt.expiresAt <= new Date() || attempt.redeemedAt) return loginRequired(res)
  const user = await User.findById(attempt.userId)
  if (!user || user.status !== USER_STATUS.ACTIVE || user.role !== USER_ROLES.USER ||
      user.provider !== 'guest_purchase' || user.password || user.verified || user.appId) return loginRequired(res)

  if (attempt.sessionId) {
    const session = await stripe.checkout.sessions.retrieve(attempt.sessionId)
    if (session.status === 'expired') throw new ApiError(StatusCodes.BAD_REQUEST, 'Checkout expired. Verify your email and sign in to try again.')
    const url = session.url || `${returnOrigin}/catalog/checkout?mapId=${map._id}&session_id=${session.id}`
    return sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Checkout ready', data: { sessionId: session.id, url } })
  }

  // A deterministic Stripe key recovers checkout creation if the response or
  // database write was interrupted. Client data cannot set price or metadata.
  const result = await PaymentServices.createCheckoutSession({ authId: user._id, email: user.email }, {
    mapId: String(map._id),
    successUrl: `${returnOrigin}/catalog/checkout?mapId=${map._id}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${returnOrigin}/catalog/checkout?mapId=${map._id}&cancelled=1`,
  }, `guest-${user._id}-${tokenHash}`)
  attempt.sessionId = result.sessionId
  await attempt.save()
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Checkout ready', data: result })
})

const complete = catchAsync(async (req, res) => {
  const { checkoutToken, sessionId } = completeSchema.parse(req.body)
  const attempt = await GuestCheckout.findOne({ tokenHash: hash(checkoutToken), sessionId,
    expiresAt: { $gt: new Date() }, redeemedAt: { $exists: false } })
  if (!attempt) throw new ApiError(StatusCodes.FORBIDDEN, 'Checkout expired or already used. Sign in or verify your email to access your purchase.')
  if (attempt.returnOrigin && attempt.returnOrigin !== getReturnOrigin(req.headers?.origin)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Return to the website where checkout was started to verify this purchase.')
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const payment = await Payment.findOne({ 'metadata.checkoutSessionId': sessionId, userId: attempt.userId, mapId: attempt.mapId })
  if (!payment || session.payment_status !== 'paid' || session.status !== 'complete' ||
      session.metadata?.userId !== String(attempt.userId) || session.metadata?.mapId !== String(attempt.mapId) ||
      session.amount_total !== Math.round(payment.amount * 100) || session.currency !== payment.currency.toLowerCase() ||
      payment.status === 'refunded') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment is not complete or is no longer available. Please retry or contact support.')
  }
  // Fulfilment also works when the browser returns before the webhook.
  await PaymentServices.verifyCheckoutSession(sessionId)
  const user = await User.findById(attempt.userId)
  if (!user || user.status !== USER_STATUS.ACTIVE || user.role !== USER_ROLES.USER ||
      user.provider !== 'guest_purchase' || user.password || user.verified || user.appId) return loginRequired(res)

  const redeemed = await GuestCheckout.findOneAndUpdate({ _id: attempt._id, redeemedAt: { $exists: false } },
    { $set: { redeemedAt: new Date() } }, { new: true })
  if (!redeemed) return loginRequired(res)
  const tokens = AuthHelper.createToken(user._id, user.role, user.name, user.email)
  res.cookie('refreshToken', tokens.refreshToken, { secure: config.node_env === 'production', httpOnly: true,
    sameSite: config.node_env === 'production' ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 })
  // Payment proves purchase, not ownership of the typed email. Keep verified=false.
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Purchase ready',
    data: { accessToken: tokens.accessToken, mapId: String(attempt.mapId) } })
})

export const GuestCheckoutController = { start, complete }
