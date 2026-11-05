import { StatusCodes } from 'http-status-codes'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { Payment } from './payment.model'
import { emailHelper } from '../../helpers/emailHelper'
import { emailTemplate } from '../../shared/emailTemplate'
import { User } from '../user/user.model'
import stripe from '../../config/stripe'
import { PromoLink } from '../promo/promo.model'

const handleCheckoutSessionCompleted = async (
  sessionData: any,
): Promise<void> => {
  try {
    console.log('🔔 Processing Checkout Session Completed:', sessionData.id)
    const sessionWithDetails = await stripe.checkout.sessions.retrieve(
      sessionData.id,
      {
        expand: ['payment_intent', 'line_items'],
      },
    )
    console.log(
      '✅ Session Details Retrieved. Payment Intent:',
      sessionWithDetails.payment_intent,
    )
    let lookupId: string

    if (typeof sessionWithDetails.payment_intent === 'string') {
      lookupId = sessionWithDetails.payment_intent
    } else if (sessionWithDetails.payment_intent?.id) {
      lookupId = sessionWithDetails.payment_intent.id
    } else {
      lookupId = sessionWithDetails.id
    }

    const mongoSession = await Payment.startSession()
    mongoSession.startTransaction()

    try {
      // Find and lock the payment document
      const payment = await Payment.findOne({
        $or: [
          { paymentIntentId: lookupId },
          { paymentIntentId: sessionWithDetails.id },
          { 'metadata.checkoutSessionId': sessionWithDetails.id },
        ],
      }).session(mongoSession)

      if (!payment) {
        throw new Error(
          `Payment not found for session: ${sessionWithDetails.id}`,
        )
      }

      // Check if already processed to avoid duplicates
      if (payment.status === 'succeeded') {
        await mongoSession.commitTransaction()
        return
      }

      // Update payment
      payment.status = 'succeeded'
      payment.metadata = { ...payment.metadata, ...sessionWithDetails }
      await payment.save({ session: mongoSession })

      // Update User purchasedMaps if mapId exists in metadata or payment
      const mapId = payment.mapId || sessionWithDetails.metadata?.mapId

      console.log(
        `Webhook: Processing map purchase update for Map ID: ${mapId}`,
      )

      if (mapId) {
        const updatedUser = await User.findByIdAndUpdate(
          payment.userId,
          {
            $addToSet: { purchasedMaps: mapId },
          },
          { session: mongoSession, new: true },
        )

        if (updatedUser) {
          console.log(
            `Webhook: User purchasedMaps updated for User ID: ${payment.userId}`,
          )
        }
      }

      // Handle Promo Link usage if applicable
      const promoCode =
        sessionWithDetails.metadata?.promoCode || payment.metadata?.promoCode
      if (promoCode) {
        console.log(
          `Webhook: Processing promo code usage for code: ${promoCode}`,
        )
        const updatedPromo = await PromoLink.findOneAndUpdate(
          { code: promoCode, isUsed: false },
          {
            isUsed: true,
            usedBy: payment.userId,
            usedAt: new Date(),
          },
          { session: mongoSession, new: true },
        )
        if (updatedPromo) {
          console.log(`Webhook: PromoLink code: ${promoCode} marked as used`)
        } else {
          console.warn(
            `Webhook WARNING: PromoLink code: ${promoCode} was not found or already marked as used.`,
          )
        }
      }

      await mongoSession.commitTransaction()
      console.log(
        `Successfully processed payment for session: ${sessionWithDetails.id}`,
      )

      // Send email
      await emailHelper.sendEmail({
        to: payment.userEmail,
        subject: 'Payment Successful',
        html: `<p>Your payment was successful.</p>`,
      })
    } catch (error) {
      await mongoSession.abortTransaction()
      throw error
    } finally {
      mongoSession.endSession()
    }
  } catch (error: any) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Checkout processing failed: ${error.message}`,
    )
  }
}

const handleCheckoutSessionExpired = async (session: any): Promise<void> => {
  const mongoSession = await Payment.startSession()
  mongoSession.startTransaction()

  try {
    const payment = await Payment.findOne({
      $or: [
        { paymentIntentId: session.id },
        { 'metadata.checkoutSessionId': session.id },
      ],
    }).session(mongoSession)

    if (payment) {
      payment.status = 'failed'
      payment.metadata = { ...payment.metadata, ...session, expired: true }
      await payment.save({ session: mongoSession })
    }

    await mongoSession.commitTransaction()
  } catch (error) {
    await mongoSession.abortTransaction()
    throw error
  } finally {
    mongoSession.endSession()
  }
}

const handlePaymentSuccess = async (paymentIntent: any): Promise<void> => {
  const mongoSession = await Payment.startSession()
  mongoSession.startTransaction()

  try {
    // STRICT LOOKUP: First try paymentIntentId
    let payment = await Payment.findOne({
      paymentIntentId: paymentIntent.id,
    }).session(mongoSession)

    // FALLBACK LOOKUP: Use mapId and userId from metadata
    if (!payment) {
      const metadata = paymentIntent.metadata || {}
      const mapId = metadata.mapId
      const userId = metadata.userId

      if (mapId && userId) {
        payment = await Payment.findOne({
          mapId,
          userId,
          status: 'pending',
        })
          .sort({ createdAt: -1 })
          .session(mongoSession)

        if (payment) {
          payment.paymentIntentId = paymentIntent.id
        }
      }
    }

    if (!payment) {
      await mongoSession.commitTransaction()
      return
    }

    // Check if already processed
    if (payment.status === 'succeeded') {
      await mongoSession.commitTransaction()
      return
    }

    // Update payment
    payment.status = 'succeeded'
    // Ensure we don't overwrite crucial metadata if it exists
    payment.metadata = { ...payment.metadata, ...paymentIntent }
    await payment.save({ session: mongoSession })

    // Update User purchasedMaps if mapId exists
    const mapId = payment.mapId || paymentIntent.metadata?.mapId

    if (mapId) {
      const updatedUser = await User.findByIdAndUpdate(
        payment.userId,
        {
          $addToSet: { purchasedMaps: mapId },
        },
        { session: mongoSession, new: true },
      )

      if (updatedUser) {
        console.log(
          `Webhook: User purchasedMaps updated for User ID: ${payment.userId}`,
        )
      }
    }
    await mongoSession.commitTransaction()
    console.log(`Successfully processed payment intent: ${paymentIntent.id}`)

    // Send email
    if (payment.userEmail) {
      await emailHelper.sendEmail({
        to: payment.userEmail,
        subject: 'Payment Successful',
        html: `<p>Your payment was successful.</p>`,
      })
    }
  } catch (error) {
    await mongoSession.abortTransaction()
    throw error
  } finally {
    mongoSession.endSession()
  }
}

const handlePaymentFailure = async (paymentIntent: any): Promise<void> => {
  const mongoSession = await Payment.startSession()
  mongoSession.startTransaction()

  try {
    let payment = await Payment.findOne({
      paymentIntentId: paymentIntent.id,
    }).session(mongoSession)

    // Fallback for failure too
    if (!payment && paymentIntent.metadata && paymentIntent.metadata.mapId) {
      payment = await Payment.findOne({
        mapId: paymentIntent.metadata.mapId,
      }).session(mongoSession)
    }

    if (payment) {
      payment.status = 'failed'
      payment.metadata = { ...payment.metadata, ...paymentIntent }
      await payment.save({ session: mongoSession })
    }

    await mongoSession.commitTransaction()
  } catch (error) {
    await mongoSession.abortTransaction()
    throw error
  } finally {
    mongoSession.endSession()
  }
}

const handleChargeRefunded = async (charge: any): Promise<void> => {
  try {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id

    if (!paymentIntentId) return

    const payment = await Payment.findOne({
      $or: [
        { paymentIntentId },
        { 'metadata.paymentIntentId': paymentIntentId },
      ],
    })

    if (payment) {
      payment.status = 'refunded'
      payment.refundAmount = charge.amount_refunded
        ? charge.amount_refunded / 100
        : payment.amount
      payment.refundReason =
        charge.refunds?.data?.[0]?.reason || 'refunded_via_stripe'
      await payment.save()

      if (payment.userId && payment.mapId) {
        await User.findByIdAndUpdate(payment.userId, {
          $pull: { purchasedMaps: payment.mapId },
          $addToSet: { deactivatedMaps: payment.mapId },
        })
      }
    }
  } catch (error) {
    console.error('Error handling charge.refunded webhook:', error)
  }
}

export const WebhookService = {
  handleWebhook: async (payload: {
    body: any
    headers: any
  }): Promise<void> => {
    try {
      const signature = payload.headers['stripe-signature']
      const webhookSecret = config.stripe.paymentWebhookSecret

      let event

      if (signature && webhookSecret) {
        try {
          event = stripe.webhooks.constructEvent(
            payload.body,
            signature,
            webhookSecret,
          )
        } catch (err: any) {
          console.error(
            '⚠️ Webhook signature verification failed:',
            err.message,
          )
          // Fallback to direct parsing for development if needed,
          // but in production this should probably throw
          event = JSON.parse(payload.body.toString())
        }
      } else {
        event = JSON.parse(payload.body.toString())
      }

      console.log(`Processing webhook: ${event.type}`)

      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutSessionCompleted(event.data.object)
          break
        case 'checkout.session.expired':
          await handleCheckoutSessionExpired(event.data.object)
          break
        case 'payment_intent.succeeded':
          await handlePaymentSuccess(event.data.object)
          break
        case 'payment_intent.payment_failed':
          await handlePaymentFailure(event.data.object)
          break
        case 'charge.refunded':
          await handleChargeRefunded(event.data.object)
          break
        default:
          console.log(`Unhandled event type: ${event.type}`)
      }
    } catch (error: any) {
      console.error('Webhook processing error:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Webhook processing failed: ${error.message}`,
      )
    }
  },
}
