import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { subscriptionService } from './subscription.service'
import { webhookService } from './webhook.service'
import { IUser } from '../user/user.interface'
import { JwtPayload } from 'jsonwebtoken'
import { localizeDocument } from '../../helpers/localize'

const planFields = [
  'name',
  'description',
  'features',
  'planId.name',
  'planId.description',
  'planId.features',
]

// Get available subscription plans
const getAvailablePlans = catchAsync(async (req: Request, res: Response) => {
  const plans = await subscriptionService.getAvailablePlans()

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Subscription plans retrieved successfully',
    data: localizeDocument(plans, req.lang, planFields),
  })
})

// Get specific plan by ID
const getPlanById = catchAsync(async (req: Request, res: Response) => {
  const { planId } = req.params

  const plan = await subscriptionService.getPlanById(planId)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Subscription plan retrieved successfully',
    data: localizeDocument(plan, req.lang, planFields),
  })
})

// Check trial eligibility
const checkTrialEligibility = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as JwtPayload
    const userId = req.params.userId || user.authId?.toString()

    const trialInfo = await subscriptionService.checkTrialEligibility(userId!)

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Trial eligibility checked successfully',
      data: trialInfo,
    })
  },
)

// Create subscription
const createSubscription = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const userId = user.authId!.toString()

  const result = await subscriptionService.createSubscription(userId, req.body)

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Subscription created successfully',
    data: result,
  })
})

// Get user's current subscription(s)
const getUserSubscription = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const userId = user.authId!.toString()
  const { businessId } = req.query

  if (businessId) {
    const subscription = await subscriptionService.getUserSubscription(userId, businessId as string)
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: subscription
        ? 'Subscription retrieved successfully'
        : 'No active subscription found',
      data: subscription ? localizeDocument(subscription, req.lang, planFields) : {},
    })
  } else {
    const subscriptions = await subscriptionService.getUserSubscriptions(userId)
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: subscriptions.length > 0
        ? 'Subscriptions retrieved successfully'
        : 'No active subscription found',
      data: localizeDocument(subscriptions, req.lang, planFields),
    })
  }
})

// Update subscription
const updateSubscription = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const userId = user.authId!.toString()
  const { subscriptionId } = req.params

  const subscription = await subscriptionService.updateSubscription(
    userId,
    subscriptionId,
    req.body,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Subscription updated successfully',
    data: subscription,
  })
})

// Cancel subscription
const cancelSubscription = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const userId = user.authId!.toString()
  const { subscriptionId } = req.params
  const { cancelAtPeriodEnd = true } = req.body

  const subscription = await subscriptionService.cancelSubscription(
    userId,
    subscriptionId,
    cancelAtPeriodEnd,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Subscription canceled successfully',
    data: subscription,
  })
})

// Get subscription status
const getSubscriptionStatus = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as JwtPayload
    const userId = user.authId!.toString()
    const { businessId } = req.query

    const status = await subscriptionService.getSubscriptionStatus(userId, businessId as string)

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Subscription status retrieved successfully',
      data: status,
    })
  },
)

// Create checkout session
const createCheckoutSession = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as JwtPayload
    const userId = user.authId!.toString()
    const { planId, businessId, successUrl, cancelUrl } = req.body

    const session = await subscriptionService.createCheckoutSession(
      userId,
      planId,
      businessId,
      successUrl,
      cancelUrl,
    )

    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: 'Checkout session created successfully',
      data: session,
    })
  },
)

const verifyCheckoutSession = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as JwtPayload
    const userId = user.authId!.toString()
    const sessionId = req.query.sessionId as string

    const result = await subscriptionService.verifyCheckoutSession(
      userId,
      sessionId,
    )

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: result.hasActiveSubscription
        ? 'Subscription verified successfully'
        : 'Checkout verified, but subscription is not active yet',
      data: result,
    })
  },
)

// Handle Stripe webhooks
const handleWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string
  const payload = req.body


  // Verify webhook signature and construct event
  const event = webhookService.verifyWebhookSignature(payload, signature)

  // Process the webhook event
  await webhookService.processWebhookEvent(event)

  // Respond to Stripe
  res.status(StatusCodes.OK).json({ received: true })
})

// Admin: Create subscription plan
const createSubscriptionPlan = catchAsync(
  async (req: Request, res: Response) => {
    const plan = await subscriptionService.createSubscriptionPlan(req.body)

    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: 'Subscription plan created successfully',
      data: localizeDocument(plan, req.lang, planFields),
    })
  },
)

// Admin: Update subscription plan
const updateSubscriptionPlan = catchAsync(
  async (req: Request, res: Response) => {
    const { planId } = req.params

    const plan = await subscriptionService.updateSubscriptionPlan(
      planId,
      req.body,
    )

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Subscription plan updated successfully',
      data: localizeDocument(plan, req.lang, planFields),
    })
  },
)

// Admin: Delete subscription plan (soft delete)
const deleteSubscriptionPlan = catchAsync(
  async (req: Request, res: Response) => {
    const { planId } = req.params

    const plan = await subscriptionService.deleteSubscriptionPlan(planId)

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Subscription plan deleted successfully',
      data: plan,
    })
  },
)

// Admin: Get all plans (including inactive)
const getAllPlans = catchAsync(async (req: Request, res: Response) => {
  // For admin, get all plans including inactive ones
  const plans = await subscriptionService.getAvailablePlans()

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'All subscription plans retrieved successfully',
    data: localizeDocument(plans, req.lang, planFields),
  })
})

// Admin: Get all user subscriptions
const getAllSubscriptions = catchAsync(async (req: Request, res: Response) => {
  const result = await subscriptionService.getAllSubscriptions(req.query)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'All subscriptions retrieved successfully',
    meta: result.meta,
    data: result.result,
  })
})

// Admin: Get subscription analytics
const getSubscriptionAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, planId, status } = req.query

    const filters: any = {}
    if (startDate) filters.startDate = new Date(startDate as string)
    if (endDate) filters.endDate = new Date(endDate as string)
    if (planId) filters.planId = planId as string
    if (status) filters.status = status as string

    const analytics =
      await subscriptionService.getSubscriptionAnalytics(filters)

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Subscription analytics retrieved successfully',
      data: analytics,
    })
  },
)

// Reactivate canceled subscription
const reactivateSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as JwtPayload
    const userId = user.authId!.toString()
    const { subscriptionId } = req.params

    const subscription = await subscriptionService.reactivateSubscription(
      userId,
      subscriptionId,
    )

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Subscription reactivated successfully',
      data: subscription,
    })
  },
)

// Retry failed payment
const retryFailedPayment = catchAsync(async (req: Request, res: Response) => {
  const { subscriptionId } = req.params

  await subscriptionService.retryFailedPayment(subscriptionId)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment retry initiated successfully',
    data: null,
  })
})

// Pause subscription
const pauseSubscription = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const userId = user.authId!.toString()
  const { subscriptionId } = req.params

  const subscription = await subscriptionService.pauseSubscription(
    userId,
    subscriptionId,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Subscription paused successfully',
    data: subscription,
  })
})

// Resume subscription
const resumeSubscription = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const userId = user.authId!.toString()
  const { subscriptionId } = req.params

  const subscription = await subscriptionService.resumeSubscription(
    userId,
    subscriptionId,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Subscription resumed successfully',
    data: subscription,
  })
})

// Get usage data
const getUsageData = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Usage data retrieved successfully',
    data: {},
  })
})

// Check usage warnings
const getUsageWarnings = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Usage warnings retrieved successfully',
    data: { warnings: [], suggestions: [] },
  })
})

// Get billing portal session
const createBillingPortal = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload
  const userId = user.authId!.toString()
  const { returnUrl } = req.body

  const portalSession = await subscriptionService.createBillingPortalSession(
    userId,
    returnUrl,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Billing portal session created successfully',
    data: portalSession,
  })
})

export const SubscriptionController = {
  // Public endpoints
  getAvailablePlans,
  getPlanById,

  // User endpoints (require authentication)
  checkTrialEligibility,
  createSubscription,
  getUserSubscription,
  updateSubscription,
  cancelSubscription,
  getSubscriptionStatus,
  createCheckoutSession,
  verifyCheckoutSession,
  reactivateSubscription,
  pauseSubscription,
  resumeSubscription,
  getUsageData,
  getUsageWarnings,
  createBillingPortal,

  // Webhook endpoint
  handleWebhook,

  // Admin endpoints (require admin role)
  createSubscriptionPlan,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  getAllPlans,
  getAllSubscriptions,
  getSubscriptionAnalytics,
  retryFailedPayment,
}
