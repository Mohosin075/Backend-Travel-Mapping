import { StatusCodes } from 'http-status-codes'
import { Types } from 'mongoose'
import ApiError from '../../errors/ApiError'
import { User } from '../user/user.model'
import { stripeService } from './stripe.service'
import { Subscription } from './subscription.model'
import { SubscriptionPlan } from './subscription-plan.model'
import {
  ISubscription,
  ISubscriptionPlan,
  CreateSubscriptionRequest,
  UpdateSubscriptionRequest,
  SubscriptionResponse,
  TrialInfo,
  SubscriptionStatus,
} from './subscription.interface'
import { emailNotificationService } from './email-notification.service'
import QueryBuilder from '../../builder/QueryBuilder'
import { Business } from '../business/business.model'
import { autoTranslateField } from '../../utils/autoTranslate'

const processPlanTranslations = async (payload: any) => {
  if (payload.name) payload.name = await autoTranslateField(payload.name)
  if (payload.description) payload.description = await autoTranslateField(payload.description)
  if (payload.features && Array.isArray(payload.features)) {
    payload.features = await Promise.all(
      payload.features.map((f: any) => autoTranslateField(f))
    )
  }
}

class SubscriptionService {
  // Get all available subscription plans
  async getAvailablePlans(): Promise<ISubscriptionPlan[]> {
    try {
      const query: any = { isActive: true }

      const plans = await SubscriptionPlan.find(query).sort({
        priority: 1,
        price: 1,
      })
      return plans
    } catch (error) {
      console.error('Error fetching subscription plans:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to fetch subscription plans',
      )
    }
  }

  // Get plan by ID
  async getPlanById(planId: string): Promise<ISubscriptionPlan> {
    try {
      const plan = await SubscriptionPlan.findById(planId)
      if (!plan) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription plan not found')
      }
      return plan
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error fetching subscription plan:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to fetch subscription plan',
      )
    }
  }

  // Check trial eligibility
  async checkTrialEligibility(userId: string): Promise<TrialInfo> {
    try {
      const existingSubscription = await Subscription.findOne({
        userId: new Types.ObjectId(userId),
        hasUsedTrial: true,
      })

      const isEligible = !existingSubscription

      return {
        isEligible,
        hasUsedTrial: !!existingSubscription,
        trialDays: 10, // Default trial period
        reason: isEligible
          ? undefined
          : 'User has already used their free trial',
      }
    } catch (error) {
      console.error('Error checking trial eligibility:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to check trial eligibility',
      )
    }
  }

  // Create subscription
  async createSubscription(
    userId: string,
    request: CreateSubscriptionRequest,
  ): Promise<SubscriptionResponse> {
    try {
      // Validate user exists
      const user = await User.findById(userId).select('+email')
      if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
      }

      // Validate business exists and belongs to the user
      const business = await Business.findOne({ _id: request.businessId, user: userId })
      if (!business) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Business not found or does not belong to you')
      }

      // Validate plan exists
      const plan = await this.getPlanById(request.planId)

      // Check if this business already has an active subscription
      const existingSubscription = await Subscription.findOne({
        businessId: new Types.ObjectId(request.businessId),
        status: { $in: ['active', 'trialing'] },
      })
      if (existingSubscription) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          'This business already has an active subscription',
        )
      }

      // Check trial eligibility
      const trialInfo = await this.checkTrialEligibility(userId)

      // Create or get Stripe customer
      let stripeCustomerId: string
      const existingCustomer = await Subscription.findOne({ userId }).select(
        'stripeCustomerId',
      )

      if (existingCustomer?.stripeCustomerId) {
        stripeCustomerId = existingCustomer.stripeCustomerId
      } else {
        const stripeCustomer = await stripeService.createCustomer(
          user.email!,
          (user as any).fullName || user.name,
          { userId: userId.toString() },
        )
        stripeCustomerId = stripeCustomer.id
      }

      // Attach payment method if provided
      if (request.paymentMethodId) {
        await stripeService.attachPaymentMethod(
          request.paymentMethodId,
          stripeCustomerId,
        )
        await stripeService.setDefaultPaymentMethod(
          stripeCustomerId,
          request.paymentMethodId,
        )
      }
      // Create Stripe subscription
      const stripeSubscription = await stripeService.createSubscription({
        customerId: stripeCustomerId,
        priceId: plan.stripePriceId,
        trialPeriodDays: trialInfo.isEligible
          ? plan.trialPeriodDays
          : undefined,
        paymentMethodId: request.paymentMethodId,
        metadata: {
          userId: userId.toString(),
          planId: request.planId,
          businessId: request.businessId,
        },
      })

      // Create local subscription record
      // In newer Stripe API versions (like 2025-08-27.basil), current_period_start/end are moved to items.data[0]
      const subscriptionItem = stripeSubscription.items.data[0]
      const currentPeriodStart =
        (stripeSubscription as any).current_period_start ||
        (subscriptionItem as any).current_period_start
      const currentPeriodEnd =
        (stripeSubscription as any).current_period_end ||
        (subscriptionItem as any).current_period_end

      const subscription = new Subscription({
        userId: new Types.ObjectId(userId),
        businessId: new Types.ObjectId(request.businessId),
        planId: new Types.ObjectId(request.planId),
        stripeCustomerId,
        stripeSubscriptionId: stripeSubscription.id,
        stripePriceId: plan.stripePriceId,
        status: stripeSubscription.status,
        currentPeriodStart: currentPeriodStart
          ? new Date(currentPeriodStart * 1000)
          : new Date(),
        currentPeriodEnd: currentPeriodEnd
          ? new Date(currentPeriodEnd * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        trialStart: stripeSubscription.trial_start
          ? new Date(stripeSubscription.trial_start * 1000)
          : null,
        trialEnd: stripeSubscription.trial_end
          ? new Date(stripeSubscription.trial_end * 1000)
          : null,
        hasUsedTrial: trialInfo.isEligible,
        metadata: new Map(Object.entries(stripeSubscription.metadata || {})),
      })

      await subscription.save()

      // Update user profile with customer info only
      await User.findByIdAndUpdate(userId, {
        stripeCustomerId,
        trialUsed: trialInfo.isEligible,
      })

      // Update business hasActiveSubscription
      const isActive = ['active', 'trialing'].includes(stripeSubscription.status)
      await Business.findByIdAndUpdate(
        request.businessId,
        { hasActiveSubscription: isActive, plan: plan._id }
      )

      // Send welcome email
      await emailNotificationService.sendSubscriptionWelcomeEmail(
        subscription,
        plan,
        !!stripeSubscription.trial_start,
      )

      // Get client secret for payment confirmation if needed
      let clientSecret: string | undefined


      // Try getting from latest invoice's payment intent
      if (
        stripeSubscription.latest_invoice &&
        typeof stripeSubscription.latest_invoice === 'object'
      ) {
        const invoice = stripeSubscription.latest_invoice as any
        if (
          invoice.payment_intent &&
          typeof invoice.payment_intent === 'object'
        ) {
          clientSecret =
            (invoice.payment_intent as any).client_secret || undefined
        }
      }

      // If still undefined, try setup_intent (common for free trials or setup flow)
      if (!clientSecret && stripeSubscription.pending_setup_intent) {
        if (typeof stripeSubscription.pending_setup_intent === 'object') {
          clientSecret =
            (stripeSubscription.pending_setup_intent as any).client_secret ||
            undefined
        }
      }


      console.log(
        `Subscription created for user ${userId}: ${subscription._id}`,
      )

      return {
        subscription: await subscription.populate(['planId']),
        clientSecret,
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error creating subscription:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to create subscription',
      )
    }
  }

  // Get user's current subscription
  async getUserSubscription(userId: string, businessId?: string): Promise<ISubscription | null> {
    try {
      const query: any = { userId: new Types.ObjectId(userId) }
      if (businessId) {
        query.businessId = new Types.ObjectId(businessId)
      }
      const subscription = await Subscription.findOne(query)
        .sort({ createdAt: -1 })
        .populate('planId')
        .populate('businessId')
      return subscription
    } catch (error) {
      console.error('Error fetching user subscription:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to fetch subscription',
      )
    }
  }

  async getUserSubscriptions(userId: string): Promise<ISubscription[]> {
    try {
      const subscriptions = await Subscription.find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .populate('planId')
        .populate('businessId')
      return subscriptions
    } catch (error) {
      console.error('Error fetching user subscriptions:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to fetch subscriptions',
      )
    }
  }

  // Admin: Get all subscriptions with filters and pagination
  async getAllSubscriptions(query: Record<string, unknown>) {
    try {
      const subscriptionQuery = new QueryBuilder(
        Subscription.find().populate(['userId', 'planId']),
        query,
      )
        .filter()
        .sort()
        .paginate()
        .fields()

      const result = await subscriptionQuery.modelQuery
      const meta = await subscriptionQuery.getPaginationInfo()

      // Provide demo data if database is empty
      if (result.length === 0) {
        const demoData = [
          {
            _id: 'demo_1',
            userId: {
              name: 'Jane Smith',
              email: 'jane@example.com',
            },
            planId: {
              name: 'Monthly',
              price: 14.99,
              interval: 'month',
            },
            status: 'active',
            currentPeriodStart: new Date('2025-12-15'),
            currentPeriodEnd: new Date('2026-02-15'),
            cancelAtPeriodEnd: false,
            paymentMethod: 'Visa **** 4242',
          },
          {
            _id: 'demo_2',
            userId: {
              name: 'Mike Ross',
              email: 'mike@example.com',
            },
            planId: {
              name: 'Yearly',
              price: 199.98,
              interval: 'year',
            },
            status: 'active',
            currentPeriodStart: new Date('2025-01-01'),
            currentPeriodEnd: new Date('2026-01-01'),
            cancelAtPeriodEnd: false,
            paymentMethod: 'Mastercard **** 8888',
          },
        ]
        return {
          meta: {
            page: 1,
            limit: 10,
            total: 2,
            totalPage: 1,
          },
          result: demoData,
        }
      }

      return {
        meta,
        result,
      }
    } catch (error) {
      console.error('Error fetching all subscriptions:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to fetch all subscriptions',
      )
    }
  }

  // Update subscription (change plan)
  async updateSubscription(
    userId: string,
    subscriptionId: string,
    request: UpdateSubscriptionRequest,
  ): Promise<ISubscription> {
    try {
      // Find existing subscription
      const subscription = await Subscription.findOne({
        _id: subscriptionId,
        userId: new Types.ObjectId(userId),
      })

      if (!subscription) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found')
      }

      const updateParams: any = {}

      // Handle plan change
      if (request.planId) {
        const newPlan = await this.getPlanById(request.planId)

        // Get current Stripe subscription to find subscription item ID
        const stripeSubscription = await stripeService.getSubscription(
          subscription.stripeSubscriptionId,
        )
        const subscriptionItemId = stripeSubscription.items.data[0].id

        // Update Stripe subscription with correct item ID
        await stripeService.updateSubscription(
          subscription.stripeSubscriptionId,
          {
            items: [
              {
                id: subscriptionItemId, // Use subscription item ID, not subscription ID
                price: newPlan.stripePriceId,
              },
            ],
            proration_behavior: 'create_prorations', // This handles automatic proration
          },
        )

        updateParams.planId = new Types.ObjectId(request.planId)
        updateParams.stripePriceId = newPlan.stripePriceId

        // Update user profile with new subscription tier
        await User.findByIdAndUpdate(userId, {
          subscriptionTier: this.getSubscriptionTier(newPlan.name),
        })

        // Send plan change notification email
        const { emailNotificationService } = await import(
          './email-notification.service'
        )
        await emailNotificationService.sendPlanChangeEmail(
          subscription,
          newPlan,
          stripeSubscription.items.data[0].price,
        )
      }

      // Handle cancellation
      if (request.cancelAtPeriodEnd !== undefined) {
        await stripeService.updateSubscription(
          subscription.stripeSubscriptionId,
          {
            cancel_at_period_end: request.cancelAtPeriodEnd,
          },
        )

        updateParams.cancelAtPeriodEnd = request.cancelAtPeriodEnd
        if (request.cancelAtPeriodEnd) {
          updateParams.canceledAt = new Date()
        }
      }

      // Update local subscription
      const updatedSubscription = await Subscription.findByIdAndUpdate(
        subscriptionId,
        updateParams,
        { new: true },
      ).populate(['planId'])

      console.log(`Subscription updated: ${subscriptionId}`)
      return updatedSubscription!
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error updating subscription:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to update subscription',
      )
    }
  }

  // Cancel subscription
  async cancelSubscription(
    userId: string,
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true,
  ): Promise<ISubscription> {
    try {
      const subscription = await Subscription.findOne({
        _id: subscriptionId,
        userId: new Types.ObjectId(userId),
      })

      if (!subscription) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found')
      }

      // Cancel in Stripe
      await stripeService.cancelSubscription(
        subscription.stripeSubscriptionId,
        cancelAtPeriodEnd,
      )

      // Update local subscription
      const updateData: any = {
        cancelAtPeriodEnd,
        canceledAt: new Date(),
      }

      if (!cancelAtPeriodEnd) {
        updateData.status = 'canceled'
        updateData.endedAt = new Date()

        // Update business hasActiveSubscription
        if (subscription.businessId) {
          await Business.findByIdAndUpdate(
            subscription.businessId,
            { hasActiveSubscription: false }
          )
        }
      }

      const updatedSubscription = await Subscription.findByIdAndUpdate(
        subscriptionId,
        updateData,
        { new: true },
      ).populate(['planId'])

      console.log(`Subscription canceled: ${subscriptionId}`)
      return updatedSubscription!
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error canceling subscription:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to cancel subscription',
      )
    }
  }

  // Reactivate subscription
  async reactivateSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<ISubscription> {
    try {
      const subscription = await Subscription.findOne({
        _id: subscriptionId,
        userId: new Types.ObjectId(userId),
      })

      if (!subscription) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found')
      }

      if (subscription.status === 'canceled' && subscription.endedAt) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Subscription has already ended and cannot be reactivated. Please start a new subscription.',
        )
      }

      if (!subscription.cancelAtPeriodEnd) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Subscription is not set to cancel and is already active.',
        )
      }

      // Reactivate in Stripe
      await stripeService.reactivateSubscription(
        subscription.stripeSubscriptionId,
      )

      // Update local subscription
      const updatedSubscription = await Subscription.findByIdAndUpdate(
        subscriptionId,
        {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          resumedAt: new Date(),
        },
        { new: true },
      ).populate(['planId'])

      // Update business hasActiveSubscription
      const isActive = ['active', 'trialing'].includes(updatedSubscription!.status)
      if (updatedSubscription?.businessId) {
        await Business.findByIdAndUpdate(
          updatedSubscription.businessId,
          { hasActiveSubscription: isActive }
        )
      }

      // Send reactivation email
      const plan = updatedSubscription?.planId as unknown as ISubscriptionPlan
      if (plan) {
        await emailNotificationService.sendSubscriptionWelcomeEmail(
          updatedSubscription!,
          plan,
          updatedSubscription!.status === 'trialing',
        )
      }

      console.log(`Subscription reactivated: ${subscriptionId}`)
      return updatedSubscription!
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error reactivating subscription:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to reactivate subscription',
      )
    }
  }

  // Get subscription status
  async getSubscriptionStatus(userId: string, businessId?: string): Promise<SubscriptionStatus> {
    try {
      const query: any = {
        userId: new Types.ObjectId(userId),
        status: { $in: ['active', 'trialing'] },
      }
      if (businessId) {
        query.businessId = new Types.ObjectId(businessId)
      }
      const subscription = await Subscription.findOne(query).populate('planId')

      if (!subscription) {
        return {
          isActive: false,
          isTrialing: false,
          isPastDue: false,
          isCanceled: false,
          daysUntilExpiry: 0,
        }
      }

      const now = new Date()
      const endDate = subscription.currentPeriodEnd
      const daysUntilExpiry = Math.ceil(
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      )

      // Ensure planId is populated, if not fetch it separately
      let currentPlan: ISubscriptionPlan | undefined
      if (
        subscription.planId &&
        typeof subscription.planId === 'object' &&
        'name' in subscription.planId &&
        'description' in subscription.planId &&
        'price' in subscription.planId
      ) {
        // planId is properly populated with plan data
        currentPlan = subscription.planId as unknown as ISubscriptionPlan
      } else {
        // Fallback: fetch the plan separately if not populated
        currentPlan = await this.getPlanById(subscription.planId.toString())
      }

      return {
        isActive: ['active', 'trialing'].includes(subscription.status),
        isTrialing: subscription.status === 'trialing',
        isPastDue: subscription.status === 'past_due',
        isCanceled: subscription.status === 'canceled',
        daysUntilExpiry: Math.max(0, daysUntilExpiry),
        currentPlan,
      }
    } catch (error) {
      console.error('Error getting subscription status:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get subscription status',
      )
    }
  }

  // Create checkout session
  async createCheckoutSession(
    userId: string,
    planId: string,
    businessId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ sessionId: string; url: string }> {
    try {
      const user = await User.findById(userId).select('+email')
      if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
      }

      // Validate business exists and belongs to the user
      const business = await Business.findOne({ _id: businessId, user: userId })
      if (!business) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Business not found or does not belong to you')
      }

      const plan = await this.getPlanById(planId)
      const trialInfo = await this.checkTrialEligibility(userId)

      // Check if this business already has an active subscription
      const existingSubscription = await Subscription.findOne({
        businessId: new Types.ObjectId(businessId),
        status: { $in: ['active', 'trialing'] },
      })
      if (existingSubscription) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          'This business already has an active subscription',
        )
      }

      // Create or get Stripe customer
      let stripeCustomerId: string
      const existingCustomer = await Subscription.findOne({ userId }).select(
        'stripeCustomerId',
      )

      if (existingCustomer?.stripeCustomerId) {
        stripeCustomerId = existingCustomer.stripeCustomerId
      } else {
        const stripeCustomer = await stripeService.createCustomer(
          user.email!,
          (user as any).fullName || user.name,
          { userId: userId.toString() },
        )
        stripeCustomerId = stripeCustomer.id
      }

      const sessionIdJoin = successUrl.includes('?') ? '&' : '?'
      const successUrlWithSession = successUrl.includes('{CHECKOUT_SESSION_ID}')
        ? successUrl
        : `${successUrl}${sessionIdJoin}session_id={CHECKOUT_SESSION_ID}`

      const session = await stripeService.createCheckoutSession({
        customerId: stripeCustomerId,
        priceId: plan.stripePriceId,
        successUrl: successUrlWithSession,
        cancelUrl,
        trialPeriodDays: trialInfo.isEligible
          ? plan.trialPeriodDays
          : undefined,
        metadata: {
          userId: userId.toString(),
          planId,
          businessId,
        },
      })

      return {
        sessionId: session.id,
        url: session.url!,
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error creating checkout session:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to create checkout session',
      )
    }
  }

  async verifyCheckoutSession(userId: string, sessionId: string) {
    try {
      const session = await stripeService.getCheckoutSession(sessionId)

      if (session.mode !== 'subscription') {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'This checkout is not a business subscription',
        )
      }

      const sessionUserId = session.metadata?.userId
      if (sessionUserId && sessionUserId !== userId) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          'This checkout does not belong to you',
        )
      }

      if (session.status !== 'complete') {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Checkout is not complete yet',
        )
      }

      if (!session.subscription) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'No subscription was created for this checkout',
        )
      }

      const stripeSubscription = await stripeService.getSubscription(
        session.subscription as string,
      )

      const businessId =
        stripeSubscription.metadata?.businessId || session.metadata?.businessId
      if (!businessId) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'No business is attached to this checkout',
        )
      }

      const business = await Business.findOne({
        _id: businessId,
        user: userId,
      })
      if (!business) {
        throw new ApiError(
          StatusCodes.NOT_FOUND,
          'Business not found or does not belong to you',
        )
      }

      const priceId =
        typeof stripeSubscription.items.data[0].price === 'string'
          ? stripeSubscription.items.data[0].price
          : stripeSubscription.items.data[0].price.id

      const plan =
        (await SubscriptionPlan.findOne({ stripePriceId: priceId })) ||
        (session.metadata?.planId
          ? await SubscriptionPlan.findById(session.metadata.planId)
          : null)

      if (!plan) {
        throw new ApiError(
          StatusCodes.NOT_FOUND,
          'Subscription plan not found for this checkout',
        )
      }

      const subscriptionItem = stripeSubscription.items.data[0]
      const currentPeriodStart =
        (stripeSubscription as any).current_period_start ||
        (subscriptionItem as any).current_period_start
      const currentPeriodEnd =
        (stripeSubscription as any).current_period_end ||
        (subscriptionItem as any).current_period_end

      const isActive =
        ['active', 'trialing'].includes(stripeSubscription.status) ||
        session.payment_status === 'no_payment_required' ||
        session.payment_status === 'paid'

      await Subscription.findOneAndUpdate(
        { stripeSubscriptionId: stripeSubscription.id },
        {
          userId: new Types.ObjectId(userId),
          businessId: new Types.ObjectId(businessId),
          planId: plan._id,
          stripeCustomerId: stripeSubscription.customer as string,
          stripeSubscriptionId: stripeSubscription.id,
          stripePriceId: priceId,
          status: stripeSubscription.status,
          currentPeriodStart: currentPeriodStart
            ? new Date(currentPeriodStart * 1000)
            : new Date(),
          currentPeriodEnd: currentPeriodEnd
            ? new Date(currentPeriodEnd * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          trialStart: stripeSubscription.trial_start
            ? new Date(stripeSubscription.trial_start * 1000)
            : null,
          trialEnd: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
          hasUsedTrial: !!stripeSubscription.trial_start,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )

      await Business.findByIdAndUpdate(businessId, {
        hasActiveSubscription: isActive,
        plan: plan._id,
      })

      await User.findByIdAndUpdate(userId, {
        stripeCustomerId: session.customer as string,
        ...(stripeSubscription.trial_start ? { trialUsed: true } : {}),
      })

      return {
        businessId,
        status: stripeSubscription.status,
        hasActiveSubscription: isActive,
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error verifying checkout session:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to verify checkout session',
      )
    }
  }

  // Admin: Create subscription plan
  async createSubscriptionPlan(
    planData: Omit<ISubscriptionPlan, '_id' | 'createdAt' | 'updatedAt'> &
      Partial<Pick<ISubscriptionPlan, 'maxPhotos' | 'priority'>>,
  ): Promise<ISubscriptionPlan> {
    try {
      const rawName =
        typeof planData.name === 'string'
          ? planData.name
          : (planData.name as any)?.en || (planData.name as any)?.es || ''

      const existingPlan = await SubscriptionPlan.findOne({
        $or: [
          { 'name.en': rawName },
          { 'name.es': rawName },
          { name: rawName },
        ],
      })
      if (existingPlan) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          `Subscription plan "${rawName}" already exists`,
        )
      }

      await processPlanTranslations(planData)

      const maxPhotos = planData.maxPhotos ?? 1
      const priority = planData.priority ?? 0

      const stripeName =
        typeof planData.name === 'string'
          ? planData.name
          : (planData.name as any)?.en || (planData.name as any)?.es || ''
      const stripeDesc =
        typeof planData.description === 'string'
          ? planData.description
          : (planData.description as any)?.en || (planData.description as any)?.es || ''

      // Create Stripe product
      const stripeProduct = await stripeService.createProduct({
        name: stripeName,
        description: stripeDesc,
        metadata: {
          maxPhotos: maxPhotos.toString(),
        },
      })

      // Create Stripe price
      const stripePrice = await stripeService.createPrice({
        productId: stripeProduct.id,
        unitAmount: planData.price * 100, // Convert to cents
        currency: planData.currency,
        interval: planData.interval,
        intervalCount: planData.intervalCount,
        metadata: {
          planName: stripeName,
        },
      })

      // Create local plan
      const plan = new SubscriptionPlan({
        ...planData,
        maxPhotos,
        priority,
        stripeProductId: stripeProduct.id,
        stripePriceId: stripePrice.id,
      })

      await plan.save()

      console.log(`Subscription plan created: ${plan._id}`)
      return plan
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error creating subscription plan:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to create subscription plan',
      )
    }
  }

  // Admin: Update subscription plan
  async updateSubscriptionPlan(
    planId: string,
    updateData: Partial<ISubscriptionPlan>,
  ): Promise<ISubscriptionPlan> {
    try {
      const plan = await SubscriptionPlan.findById(planId)
      if (!plan) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription plan not found')
      }

      await processPlanTranslations(updateData)

      // Update Stripe product if name or description changed
      if (updateData.name || updateData.description) {
        const stripeName = updateData.name
          ? (typeof updateData.name === 'string' ? updateData.name : (updateData.name as any).en || (updateData.name as any).es)
          : (typeof plan.name === 'string' ? plan.name : (plan.name as any)?.en || (plan.name as any)?.es)
        const stripeDesc = updateData.description
          ? (typeof updateData.description === 'string' ? updateData.description : (updateData.description as any).en || (updateData.description as any).es)
          : (typeof plan.description === 'string' ? plan.description : (plan.description as any)?.en || (plan.description as any)?.es)

        await stripeService.updateProduct(plan.stripeProductId, {
          name: stripeName,
          description: stripeDesc,
        })
      }

      // Create new Stripe price if price or interval changed
      if (
        (updateData.price && updateData.price !== plan.price) ||
        (updateData.interval && updateData.interval !== plan.interval)
      ) {
        const newStripePrice = await stripeService.createPrice({
          productId: plan.stripeProductId,
          unitAmount: (updateData.price !== undefined ? updateData.price : plan.price) * 100,
          currency: updateData.currency || plan.currency,
          interval: updateData.interval || plan.interval,
          intervalCount: updateData.intervalCount || plan.intervalCount,
        })

        // Archive old price
        await stripeService.archivePrice(plan.stripePriceId)

        updateData.stripePriceId = newStripePrice.id
      }

      const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(
        planId,
        updateData,
        { new: true },
      )

      console.log(`Subscription plan updated: ${planId}`)
      return updatedPlan!
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error updating subscription plan:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to update subscription plan',
      )
    }
  }

  // Admin: Delete subscription plan (soft delete)
  async deleteSubscriptionPlan(planId: string): Promise<ISubscriptionPlan> {
    try {
      const plan = await SubscriptionPlan.findById(planId)
      if (!plan) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription plan not found')
      }

      // Do not allow deleting plans that are currently in active use
      const activeSubscriptions = await Subscription.countDocuments({
        planId: new Types.ObjectId(planId),
        status: { $in: ['active', 'trialing'] },
      })

      if (activeSubscriptions > 0) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Cannot delete a plan with active subscriptions',
        )
      }

      // Stripe resources are deactivated instead of permanently deleted.
      await stripeService.archivePrice(plan.stripePriceId)
      await stripeService.updateProduct(plan.stripeProductId, { active: false })

      const deletedPlan = await SubscriptionPlan.findByIdAndUpdate(
        planId,
        { isActive: false },
        { new: true },
      )

      return deletedPlan!
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error deleting subscription plan:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to delete subscription plan',
      )
    }
  }

  // Get subscription analytics
  async getSubscriptionAnalytics(filters?: {
    startDate?: Date
    endDate?: Date
    planId?: string
    status?: string
  }): Promise<any> {
    try {
      const matchStage: any = {}

      if (filters?.startDate || filters?.endDate) {
        matchStage.createdAt = {}
        if (filters.startDate) matchStage.createdAt.$gte = filters.startDate
        if (filters.endDate) matchStage.createdAt.$lte = filters.endDate
      }

      if (filters?.planId) {
        matchStage.planId = new Types.ObjectId(filters.planId)
      }

      if (filters?.status) {
        matchStage.status = filters.status
      }

      const analytics = await Subscription.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalSubscriptions: { $sum: 1 },
            activeSubscriptions: {
              $sum: {
                $cond: [{ $in: ['$status', ['active', 'trialing']] }, 1, 0],
              },
            },
            trialingSubscriptions: {
              $sum: { $cond: [{ $eq: ['$status', 'trialing'] }, 1, 0] },
            },
            canceledSubscriptions: {
              $sum: { $cond: [{ $eq: ['$status', 'canceled'] }, 1, 0] },
            },
            pastDueSubscriptions: {
              $sum: { $cond: [{ $eq: ['$status', 'past_due'] }, 1, 0] },
            },
          },
        },
      ])

      // Calculate MRR (Monthly Recurring Revenue)
      const mrrData = await Subscription.aggregate([
        {
          $match: {
            status: { $in: ['active', 'trialing'] },
            ...matchStage,
          },
        },
        {
          $lookup: {
            from: 'subscriptionplans',
            localField: 'planId',
            foreignField: '_id',
            as: 'plan',
          },
        },
        { $unwind: '$plan' },
        {
          $group: {
            _id: null,
            monthlyRevenue: {
              $sum: {
                $cond: [
                  { $eq: ['$plan.interval', 'month'] },
                  '$plan.price',
                  { $divide: ['$plan.price', 12] }, // Convert yearly to monthly
                ],
              },
            },
          },
        },
      ])

      const result = analytics[0] || {
        totalSubscriptions: 0,
        activeSubscriptions: 0,
        trialingSubscriptions: 0,
        canceledSubscriptions: 0,
        pastDueSubscriptions: 0,
      }

      result.monthlyRevenue = mrrData[0]?.monthlyRevenue || 0
      result.churnRate =
        result.totalSubscriptions > 0
          ? (
              (result.canceledSubscriptions / result.totalSubscriptions) *
              100
            ).toFixed(2)
          : 0

      return result
    } catch (error) {
      console.error('Error getting subscription analytics:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get subscription analytics',
      )
    }
  }

  // Retry failed payments
  async retryFailedPayment(subscriptionId: string): Promise<void> {
    try {
      const subscription = await Subscription.findById(subscriptionId)
      if (!subscription) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found')
      }

      // Get latest invoice from Stripe
      const stripeSubscription = await stripeService.getSubscriptionExpanded(
        subscription.stripeSubscriptionId,
      )

      if (
        stripeSubscription.latest_invoice &&
        typeof stripeSubscription.latest_invoice === 'object'
      ) {
        const invoice = stripeSubscription.latest_invoice as any
        // Retry payment on the invoice
        await stripeService.retryInvoicePayment(invoice.id)

        console.log(
          `Payment retry initiated for subscription: ${subscriptionId}`,
        )
      }
    } catch (error) {
      console.error('Error retrying failed payment:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to retry payment',
      )
    }
  }

  // Pause subscription (for temporary suspension)
  async pauseSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<ISubscription> {
    try {
      const subscription = await Subscription.findOne({
        _id: subscriptionId,
        userId: new Types.ObjectId(userId),
      })

      if (!subscription) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found')
      }

      // Pause in Stripe
      await stripeService.pauseSubscription(subscription.stripeSubscriptionId)

      // Update local subscription
      const updatedSubscription = await Subscription.findByIdAndUpdate(
        subscriptionId,
        { status: 'paused' },
        { new: true },
      ).populate(['planId'])

      console.log(`Subscription paused: ${subscriptionId}`)
      return updatedSubscription!
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error pausing subscription:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to pause subscription',
      )
    }
  }

  // Resume paused subscription
  async resumeSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<ISubscription> {
    try {
      const subscription = await Subscription.findOne({
        _id: subscriptionId,
        userId: new Types.ObjectId(userId),
      })

      if (!subscription) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found')
      }

      // Resume in Stripe
      await stripeService.resumeSubscription(subscription.stripeSubscriptionId)

      // Update local subscription
      const updatedSubscription = await Subscription.findByIdAndUpdate(
        subscriptionId,
        { status: 'active' },
        { new: true },
      ).populate(['planId'])

      console.log(`Subscription resumed: ${subscriptionId}`)
      return updatedSubscription!
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error resuming subscription:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to resume subscription',
      )
    }
  }

  // Create billing portal session for payment method management
  async createBillingPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    try {
      // Get user to find their Stripe customer ID
      const user = await User.findById(userId)
      if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
      }

      const userWithStripe = user as any

      if (!userWithStripe.stripeCustomerId) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'User does not have a Stripe customer account',
        )
      }

      // Create billing portal session
      const session = await stripeService.createPortalSession(
        userWithStripe.stripeCustomerId,
        returnUrl,
      )

      console.log(`Billing portal session created for user: ${userId}`)
      return { url: session.url }
    } catch (error) {
      if (error instanceof ApiError) throw error
      console.error('Error creating billing portal session:', error)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to create billing portal session',
      )
    }
  }

  // Helper method to determine subscription tier
  private getSubscriptionTier(planName: any): string {
    const raw = typeof planName === 'string' ? planName : planName?.en || planName?.es || ''
    const name = raw.toLowerCase()
    if (name.includes('enterprise') || name.includes('pro')) {
      return 'premium'
    } else if (name.includes('basic') || name.includes('starter')) {
      return 'basic'
    }
    return 'free'
  }
}

export const subscriptionService = new SubscriptionService()
