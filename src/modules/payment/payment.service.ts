import { USER_ROLES } from '../../enum/user'
import { StatusCodes } from 'http-status-codes'
import ApiError from '../../errors/ApiError'
import { IPaymentFilterables, IPayment } from './payment.interface'
import { Payment } from './payment.model'
import { JwtPayload } from 'jsonwebtoken'
import { IPaginationOptions } from '../../interfaces/pagination'
import { paginationHelper } from '../../helpers/paginationHelper'
import { paymentSearchableFields } from './payment.constants'
import { Types } from 'mongoose'
import { User } from '../user/user.model'
import { Map } from '../map/map.model'

import config from '../../config'
import { PromoLink } from '../promo/promo.model'

import { WebhookService } from './webhook.service'
import { emailHelper } from '../../helpers/emailHelper'
import { emailTemplate } from '../../shared/emailTemplate'
import stripe from '../../config/stripe'
import { generatePDFInvoice } from '../../helpers/invoiceHelper'

const createCheckoutSession = async (
  user: any,
  payload: any,
): Promise<{ sessionId: string; url: string }> => {
  try {
    const map = await Map.findById(payload.mapId)
    if (!map) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found')
    }
    if (!map.isPaid) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'This map is free and does not require checkout',
      )
    }
    if (!map.price || map.price <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Map price is not configured')
    }

    // Always charge server-side map price (ignore client amount)
    const amount = map.price
    const currency = (payload.currency || 'EUR').toLowerCase()

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: payload.productName || map.name || 'Map Purchase',
              description: payload.description || map.description,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url:
        payload.successUrl ||
        `${config.clientUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url:
        payload.cancelUrl ||
        `${config.clientUrl}/payment-failed?success=false`,
      customer_email: user.email,
      metadata: {
        userId: user.authId.toString(),
        mapId: payload.mapId.toString(),
        ...payload.metadata,
      },
    })

    await Payment.create({
      userId: user.authId,
      mapId: payload.mapId,
      userEmail: user.email,
      amount,
      currency: currency.toUpperCase(),
      paymentMethod: 'stripe',
      paymentIntentId: session.payment_intent || session.id,
      status: 'pending',
      metadata: {
        checkoutSessionId: session.id,
        mapId: payload.mapId.toString(),
        ...payload.metadata,
      },
    })

    return {
      sessionId: session.id,
      url: session.url!,
    }
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Checkout session creation failed: ${error.message}`,
    )
  }
}

const verifyCheckoutSession = async (sessionId: string): Promise<IPayment> => {
  try {
    // Retrieve session from Stripe
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    })


    const paymentIntentId =
      stripeSession.payment_intent &&
      typeof stripeSession.payment_intent === 'object'
        ? (stripeSession.payment_intent as any).id
        : (stripeSession.payment_intent as string)

    // Find payment record using either paymentIntentId (legacy/direct) or metadata.checkoutSessionId (correct for checkout)
    const payment = await Payment.findOne({
      $or: [
        { paymentIntentId: sessionId },
        { 'metadata.checkoutSessionId': sessionId },
        ...(paymentIntentId ? [{ paymentIntentId }] : []),
      ],
    }).populate('userId', 'name email')

    if (!payment) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found')
    }

    // Update payment status based on session
    if (
      stripeSession.payment_status === 'paid' &&
      payment.status !== 'succeeded'
    ) {
      const mongooseSession = await Payment.startSession()
      mongooseSession.startTransaction()

      try {
        // Update payment status
        payment.status = 'succeeded'
        payment.metadata = {
          ...payment.metadata,
          stripeSessionId: stripeSession.id,
        }
        await payment.save({ session: mongooseSession })

        // Update User purchasedMaps if mapId exists
        const mapId = payment.mapId
        if (mapId) {
          await User.findByIdAndUpdate(
            payment.userId,
            { $addToSet: { purchasedMaps: mapId } },
            { session: mongooseSession },
          )
          console.log(
            `verifyCheckoutSession: User purchasedMaps updated for User ID: ${payment.userId}`,
          )
        }

        // Handle Promo Link usage if applicable
        const promoCode =
          stripeSession.metadata?.promoCode || payment.metadata?.promoCode
        if (promoCode) {
          await PromoLink.findOneAndUpdate(
            { code: promoCode, isUsed: false },
            {
              isUsed: true,
              usedBy: payment.userId,
              usedAt: new Date(),
            },
            { session: mongooseSession },
          )
          console.log(
            `verifyCheckoutSession: PromoLink code: ${promoCode} marked as used`,
          )
        }

        // Send confirmation email
        const user = await payment.populate('userId')
        const userData = user.userId as any

        if (userData) {
          await emailHelper.sendEmail({
            to: userData.email,
            subject: 'Payment Successful',
            html: `<p>Hi ${userData.name}, your payment of ${payment.amount} ${payment.currency} was successful.</p>`,
          })
        }

        await mongooseSession.commitTransaction()
      } catch (error) {
        await mongooseSession.abortTransaction()
        throw error
      } finally {
        mongooseSession.endSession()
      }
    } else if (
      stripeSession.payment_status === 'unpaid' &&
      payment.status !== 'failed'
    ) {
      payment.status = 'failed'
      await payment.save()
    }

    return payment
  } catch (error: any) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Payment verification failed: ${error.message}`,
    )
  }
}

// ============================================
// FLUTTER STRIPE INTEGRATION METHODS
// ============================================

/**
 * Create Payment Intent for Flutter App
 * Used by flutter_stripe SDK for native mobile payments
 */
const createPaymentIntent = async (
  user: any,
  payload: any,
): Promise<{
  clientSecret: string
  paymentIntentId: string
  amount: number
}> => {
  try {
    // Same as checkout: charge Map.price server-side (never trust client amount)
    const map = await Map.findById(payload.mapId)
    if (!map) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found')
    }
    if (!map.isPaid) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'This map is free and does not require checkout',
      )
    }
    if (!map.price || map.price <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Map price is not configured')
    }

    const amount = map.price
    const currency = (payload.currency || 'eur').toLowerCase()
    const resolvedUserId = (user.authId || user.id || user._id)?.toString()

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      metadata: {
        userId: resolvedUserId,
        userEmail: user.email,
        mapId: payload.mapId.toString(),
        ...payload.metadata,
      },
    })

    // Create payment record
    await Payment.create({
      userId: user.authId || user.id || user._id,
      mapId: payload.mapId,
      userEmail: user.email,
      amount,
      currency: currency.toUpperCase(),
      paymentMethod: 'stripe',
      paymentIntentId: paymentIntent.id,
      status: 'pending',
      metadata: {
        userId: resolvedUserId,
        mapId: payload.mapId.toString(),
        ...payload.metadata,
      },
    })

    return {
      clientSecret: paymentIntent.client_secret!,
      paymentIntentId: paymentIntent.id,
      amount,
    }
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Payment Intent creation failed: ${error.message}`,
    )
  }
}

/**
 * Create Ephemeral Key for Flutter Stripe SDK
 * Required for customer-scoped operations in flutter_stripe
 */
const createEphemeralKey = async (
  user: any,
  apiVersion: string = '2025-05-28.basil',
): Promise<{ ephemeralKey: string }> => {
  try {
    let customerId = user.stripeCustomerId

    // Create customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user.authId.toString(),
        },
      })
      customerId = customer.id

      // Update user record with stripeCustomerId
      await User.findByIdAndUpdate(user.authId, {
        stripeCustomerId: customer.id,
      })
    }

    // Create ephemeral key
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: apiVersion },
    )

    return {
      ephemeralKey: ephemeralKey.secret!,
    }
  } catch (error: any) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Ephemeral key creation failed: ${error.message}`,
    )
  }
}

/**
 * Handle Payment Intent Webhook Events
 * Processes payment_intent.succeeded events from Stripe
 */
const handlePaymentIntentWebhook = async (
  paymentIntent: any,
): Promise<void> => {
  try {
    const payment = await Payment.findOne({
      paymentIntentId: paymentIntent.id,
    })

    if (!payment) {
      console.error(`Payment not found for Payment Intent: ${paymentIntent.id}`)
      return
    }

    if (payment.status === 'succeeded') {
      console.log(`Payment already processed: ${paymentIntent.id}`)
      return
    }

    // Start MongoDB transaction
    const session = await Payment.startSession()
    session.startTransaction()

    try {
      // Update payment status
      payment.status = 'succeeded'
      payment.metadata = {
        ...payment.metadata,
        processedAt: new Date().toISOString(),
      }
      await payment.save({ session })

      // Update User purchasedMaps if mapId exists
      const mapId = payment.mapId || paymentIntent.metadata?.mapId
      if (mapId) {
        await User.findByIdAndUpdate(
          payment.userId,
          { $addToSet: { purchasedMaps: mapId } },
          { session }
        )
      }

      await session.commitTransaction()
      console.log(`Payment processed successfully: ${paymentIntent.id}`)
    } catch (error) {
      await session.abortTransaction()
      throw error
    } finally {
      session.endSession()
    }
  } catch (error: any) {
    console.error(`Webhook processing failed: ${error.message}`)
    throw error
  }
}

// ============================================
// EXISTING METHODS
// ============================================

const getAllPayments = async (
  user: JwtPayload,
  filterables: IPaymentFilterables,
  pagination: IPaginationOptions,
) => {
  const { searchTerm, ...filterData } = filterables
  const { page, skip, limit, sortBy, sortOrder } =
    paginationHelper.calculatePagination(pagination)

  const andConditions = []

  // Search functionality
  if (searchTerm) {
    andConditions.push({
      $or: paymentSearchableFields.map(field => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      })),
    })
  }

  // Filter functionality
  if (Object.keys(filterData).length) {
    andConditions.push({
      $and: Object.entries(filterData).map(([key, value]) => ({
        [key]: value,
      })),
    })
  }

  // Non-admins can only see their own payments (JWT uses `role`, not `activeRole`)
  const role = (user as any).role || (user as any).activeRole
  if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(role)) {
    andConditions.push({
      userId: new Types.ObjectId(user.authId),
    })
  }

  const whereConditions = andConditions.length ? { $and: andConditions } : {}

  const [result, total] = await Promise.all([
    Payment.find(whereConditions)
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder })
      .populate('userId', 'name email')
      .populate({
        path: 'mapId',
      }),
    Payment.countDocuments(whereConditions),
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

const getSinglePayment = async (
  id: string,
  user?: JwtPayload,
): Promise<IPayment> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Payment ID')
  }

  const result = await Payment.findById(id).populate('userId', 'name email')

  if (!result) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Requested payment not found, please try again with valid id',
    )
  }

  if (user) {
    const role = (user as any).role || (user as any).activeRole
    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(role)
    const ownerId =
      (result.userId as any)?._id?.toString() || result.userId?.toString()
    if (!isAdmin && ownerId !== user.authId?.toString()) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'You are not authorized to view this payment',
      )
    }
  }

  return result
}

const updatePayment = async (
  id: string,
  payload: Partial<IPayment>,
): Promise<IPayment | null> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Payment ID')
  }

  const result = await Payment.findByIdAndUpdate(
    new Types.ObjectId(id),
    { $set: payload },
    {
      new: true,
      runValidators: true,
    },
  ).populate('userId', 'name email')

  if (!result) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Requested payment not found, please try again with valid id',
    )
  }

  return result
}

const refundPayment = async (
  id: string,
  reason?: string,
): Promise<IPayment> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Payment ID')
  }

  const payment = await Payment.findById(id)
  if (!payment) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found')
  }

  if (payment.status !== 'succeeded') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Only successful payments can be refunded',
    )
  }

  // Process refund via Stripe
  try {
    const refund = await stripe.refunds.create({
      payment_intent: payment.paymentIntentId,
      amount: Math.round(payment.amount * 100),
      reason: reason ? 'requested_by_customer' : 'duplicate',
    })

    const result = await Payment.findByIdAndUpdate(
      id,
      {
        status: 'refunded',
        refundAmount: payment.amount,
        refundReason: reason,
        metadata: { ...payment.metadata, refundId: refund.id },
      },
      { new: true, runValidators: true },
    ).populate('userId', 'name email')

    // Automatically remove user map access upon refund
    if (payment.userId && payment.mapId) {
      await User.findByIdAndUpdate(payment.userId, {
        $pull: { purchasedMaps: payment.mapId },
        $addToSet: { deactivatedMaps: payment.mapId },
      })
    }

    return result!
  } catch (error: any) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Refund failed: ${error.message}`,
    )
  }
}

const getMyPayments = async (
  user: JwtPayload,
  pagination: IPaginationOptions,
) => {
  const { page, skip, limit, sortBy, sortOrder } =
    paginationHelper.calculatePagination(pagination)

  const [result, total] = await Promise.all([
    Payment.find({ userId: new Types.ObjectId(user.authId) })
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder })
      .populate('userId', 'name email'),
    Payment.countDocuments({ userId: new Types.ObjectId(user.authId) }),
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

const generateInvoice = async (id: string): Promise<string | Buffer> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Payment ID')
  }

  const payment = await Payment.findById(id)
    .populate('userId')
    .populate('mapId')

  if (!payment) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found')
  }

  // 1. If it's a Stripe payment, try to get the official receipt URL
  if (
    payment.paymentIntentId &&
    payment.status === 'succeeded' &&
    payment.paymentMethod === 'stripe'
  ) {
    try {
      const pi = await stripe.paymentIntents.retrieve(payment.paymentIntentId)
      if (pi.latest_charge) {
        const charge = await stripe.charges.retrieve(pi.latest_charge as string)
        if (charge.receipt_url) {
          return charge.receipt_url
        }
      }
    } catch (error) {
      console.error('Failed to fetch stripe receipt:', error)
    }
  }

  // 2. Fallback to custom PDF invoice generation
  return await generatePDFInvoice(payment as any)
}

export const PaymentServices = {
  getAllPayments,
  getSinglePayment,
  updatePayment,
  refundPayment,
  getMyPayments,
  createCheckoutSession,
  verifyCheckoutSession,
  handleWebhook: WebhookService.handleWebhook,
  createPaymentIntent,
  createEphemeralKey,
  handlePaymentIntentWebhook,
  generateInvoice,
}
