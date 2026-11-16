import Stripe from 'stripe'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { StatusCodes } from 'http-status-codes'

class StripeService {
  private stripe: Stripe

  constructor() {
    if (!config.stripe.stripeSecretKey) {
      throw new Error('Stripe secret key is required')
    }

    this.stripe = new Stripe(config.stripe.stripeSecretKey, {
      apiVersion: '2024-04-10',
      typescript: true,
    })
  }

  // Customer Management
  async createCustomer(
    email: string,
    name?: string,
    metadata?: Record<string, string>,
  ): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata: metadata || {},
      })

      console.log(`Stripe customer created: ${customer.id}`)
      return customer
    } catch (error) {
      console.error('Error creating Stripe customer:', error)
      throw error
    }
  }

  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId)
      return customer as Stripe.Customer
    } catch (error) {
      console.error(`Error retrieving Stripe customer ${customerId}:`, error)
      throw error
    }
  }

  async updateCustomer(
    customerId: string,
    params: Stripe.CustomerUpdateParams,
  ): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.update(customerId, params)
      console.log(`Stripe customer updated: ${customerId}`)
      return customer
    } catch (error) {
      console.error(`Error updating Stripe customer ${customerId}:`, error)
      throw error
    }
  }

  // Subscription Management
  async createSubscription(params: {
    customerId: string
    priceId: string
    trialPeriodDays?: number
    paymentMethodId?: string
    metadata?: Record<string, string>
  }): Promise<Stripe.Subscription> {
    try {
      if (config.stripe?.automaticTaxEnabled) {
        throw new ApiError(StatusCodes.BAD_REQUEST,
          'Please use subscription Checkout so applicable tax can be calculated from your billing address.')
      }
      const subscriptionParams: Stripe.SubscriptionCreateParams = {
        customer: params.customerId,
        items: [{ price: params.priceId }],
        metadata: params.metadata || {},
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
      }

      // Add trial period if specified
      if (params.trialPeriodDays && params.trialPeriodDays > 0) {
        subscriptionParams.trial_period_days = params.trialPeriodDays
      }

      // Add payment method if provided
      if (params.paymentMethodId) {
        subscriptionParams.default_payment_method = params.paymentMethodId
      }

      const subscription =
        await this.stripe.subscriptions.create(subscriptionParams)

      console.log(`Stripe subscription created: ${subscription.id}`)
      return subscription
    } catch (error) {
      console.error('Error creating Stripe subscription:', error)
      throw error
    }
  }

  async getCheckoutSession(
    sessionId: string,
  ): Promise<Stripe.Checkout.Session> {
    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId)
    } catch (error) {
      console.error(`Error retrieving Stripe checkout session ${sessionId}:`, error)
      throw error
    }
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        {
          expand: ['latest_invoice.payment_intent'],
        },
      )
      return subscription
    } catch (error) {
      console.error(
        `Error retrieving Stripe subscription ${subscriptionId}:`,
        error,
      )
      throw error
    }
  }

  async updateSubscription(
    subscriptionId: string,
    params: Stripe.SubscriptionUpdateParams,
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.update(
        subscriptionId,
        params,
      )
      console.log(`Stripe subscription updated: ${subscriptionId}`)
      return subscription
    } catch (error) {
      console.error(
        `Error updating Stripe subscription ${subscriptionId}:`,
        error,
      )
      throw error
    }
  }

  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = false,
  ): Promise<Stripe.Subscription> {
    try {
      let subscription: Stripe.Subscription

      if (cancelAtPeriodEnd) {
        subscription = await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        })
      } else {
        subscription = await this.stripe.subscriptions.cancel(subscriptionId)
      }

      console.log(`Stripe subscription canceled: ${subscriptionId}`)
      return subscription
    } catch (error) {
      console.error(
        `Error canceling Stripe subscription ${subscriptionId}:`,
        error,
      )
      throw error
    }
  }

  async reactivateSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.update(
        subscriptionId,
        {
          cancel_at_period_end: false,
        },
      )

      console.log(`Stripe subscription reactivated: ${subscriptionId}`)
      return subscription
    } catch (error) {
      console.error(
        `Error reactivating Stripe subscription ${subscriptionId}:`,
        error,
      )
      throw error
    }
  }

  // Payment Method Management
  async attachPaymentMethod(
    paymentMethodId: string,
    customerId: string,
  ): Promise<Stripe.PaymentMethod> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.attach(
        paymentMethodId,
        {
          customer: customerId,
        },
      )

      console.log(
        `Payment method attached: ${paymentMethodId} to customer: ${customerId}`,
      )
      return paymentMethod
    } catch (error) {
      console.error('Error attaching payment method:', error)
      throw error
    }
  }

  async setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      })

      console.log(`Default payment method set for customer: ${customerId}`)
      return customer
    } catch (error) {
      console.error('Error setting default payment method:', error)
      throw error
    }
  }

  // Checkout Session
  async createCheckoutSession(params: {
    customerId: string
    priceId: string
    successUrl: string
    cancelUrl: string
    trialPeriodDays?: number
    metadata?: Record<string, string>
  }): Promise<Stripe.Checkout.Session> {
    try {
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        ...(config.stripe?.automaticTaxEnabled ? {
          automatic_tax: { enabled: true },
          billing_address_collection: 'required',
          customer_update: { address: 'auto' },
        } : {}),
        customer: params.customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: params.priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: params.metadata || {},
      }

      // Add trial period and metadata to subscription
      if (params.trialPeriodDays && params.trialPeriodDays > 0) {
        sessionParams.subscription_data = {
          trial_period_days: params.trialPeriodDays,
          metadata: params.metadata || {}, // ← Add metadata to subscription
        }
      } else {
        sessionParams.subscription_data = {
          metadata: params.metadata || {}, // ← Add metadata to subscription
        }
      }

      const session = await this.stripe.checkout.sessions.create(sessionParams)

      console.log(`Stripe checkout session created: ${session.id}`)
      return session
    } catch (error) {
      console.error('Error creating Stripe checkout session:', error)
      throw error
    }
  }

  // Invoice Management
  async getUpcomingInvoice(
    customerId: string,
  ): Promise<Stripe.UpcomingInvoice> {
    try {
      const invoice = await (this.stripe.invoices as any).retrieveUpcoming({
        customer: customerId,
      })
      return invoice as Stripe.UpcomingInvoice
    } catch (error) {
      console.error(
        `Error retrieving upcoming invoice for customer ${customerId}:`,
        error,
      )
      throw error
    }
  }

  // Webhook Verification
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
  ): Stripe.Event {
    try {
      if (!config.stripe.webhookSecret) {
        throw new Error('Stripe webhook secret is required')
      }

      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        config.stripe.webhookSecret,
      )

      return event
    } catch (error) {
      console.error('Error constructing webhook event:', error)
      throw error
    }
  }

  // Product and Price Management (for admin use)
  async createProduct(params: {
    name: string
    description?: string
    metadata?: Record<string, string>
  }): Promise<Stripe.Product> {
    try {
      const product = await this.stripe.products.create({
        name: params.name,
        description: params.description,
        metadata: params.metadata || {},
      })

      console.log(`Stripe product created: ${product.id}`)
      return product
    } catch (error) {
      console.error('Error creating Stripe product:', error)
      throw error
    }
  }

  async createPrice(params: {
    productId: string
    unitAmount: number
    currency: string
    interval: 'month' | 'year'
    intervalCount?: number
    metadata?: Record<string, string>
  }): Promise<Stripe.Price> {
    try {
      const price = await this.stripe.prices.create({
        ...(config.stripe?.automaticTaxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
        product: params.productId,
        unit_amount: params.unitAmount,
        currency: params.currency,
        recurring: {
          interval: params.interval,
          interval_count: params.intervalCount || 1,
        },
        metadata: params.metadata || {},
      })

      console.log(`Stripe price created: ${price.id}`)
      return price
    } catch (error) {
      console.error('Error creating Stripe price:', error)
      throw error
    }
  }

  // Update product
  async updateProduct(
    productId: string,
    params: Stripe.ProductUpdateParams,
  ): Promise<Stripe.Product> {
    try {
      const product = await this.stripe.products.update(productId, params)
      console.log(`Stripe product updated: ${productId}`)
      return product
    } catch (error) {
      console.error(`Error updating Stripe product ${productId}:`, error)
      throw error
    }
  }

  // Archive price (Stripe doesn't allow price deletion, only archiving)
  async archivePrice(priceId: string): Promise<Stripe.Price> {
    try {
      const price = await this.stripe.prices.update(priceId, { active: false })
      console.log(`Stripe price archived: ${priceId}`)
      return price
    } catch (error) {
      console.error(`Error archiving Stripe price ${priceId}:`, error)
      throw error
    }
  }

  // Retry invoice payment
  async retryInvoicePayment(invoiceId: string): Promise<Stripe.Invoice> {
    try {
      const invoice = await this.stripe.invoices.pay(invoiceId)
      console.log(`Invoice payment retried: ${invoiceId}`)
      return invoice
    } catch (error) {
      console.error(`Error retrying invoice payment ${invoiceId}:`, error)
      throw error
    }
  }

  // Pause subscription
  async pauseSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.update(
        subscriptionId,
        {
          pause_collection: {
            behavior: 'keep_as_draft',
          },
        },
      )
      console.log(`Stripe subscription paused: ${subscriptionId}`)
      return subscription
    } catch (error) {
      console.error(
        `Error pausing Stripe subscription ${subscriptionId}:`,
        error,
      )
      throw error
    }
  }

  // Resume subscription
  async resumeSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.update(
        subscriptionId,
        {
          pause_collection: null,
        },
      )
      console.log(`Stripe subscription resumed: ${subscriptionId}`)
      return subscription
    } catch (error) {
      console.error(
        `Error resuming Stripe subscription ${subscriptionId}:`,
        error,
      )
      throw error
    }
  }

  // Get payment method
  async getPaymentMethod(
    paymentMethodId: string,
  ): Promise<Stripe.PaymentMethod> {
    try {
      const paymentMethod =
        await this.stripe.paymentMethods.retrieve(paymentMethodId)
      return paymentMethod
    } catch (error) {
      console.error(
        `Error retrieving payment method ${paymentMethodId}:`,
        error,
      )
      throw error
    }
  }

  // List customer payment methods
  async listCustomerPaymentMethods(
    customerId: string,
  ): Promise<Stripe.PaymentMethod[]> {
    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      })
      return paymentMethods.data
    } catch (error) {
      console.error(
        `Error listing payment methods for customer ${customerId}:`,
        error,
      )
      throw error
    }
  }

  // Delete customer (for GDPR compliance)
  async deleteCustomer(customerId: string): Promise<Stripe.DeletedCustomer> {
    try {
      const deletedCustomer = await this.stripe.customers.del(customerId)
      console.log(`Stripe customer deleted: ${customerId}`)
      return deletedCustomer
    } catch (error) {
      console.error(`Error deleting Stripe customer ${customerId}:`, error)
      throw error
    }
  }

  // Create setup intent (for saving payment methods without immediate charge)
  async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        usage: 'off_session',
      })
      console.log(`Setup intent created for customer: ${customerId}`)
      return setupIntent
    } catch (error) {
      console.error('Error creating setup intent:', error)
      throw error
    }
  }

  // Create customer portal session (for managing payment methods and billing)
  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      })
      console.log(`Billing portal session created for customer: ${customerId}`)
      return session
    } catch (error) {
      console.error('Error creating billing portal session:', error)
      throw error
    }
  }

  // Get subscription with expanded data
  async getSubscriptionExpanded(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        {
          expand: [
            'latest_invoice',
            'latest_invoice.payment_intent',
            'customer',
            'items.data.price.product',
          ],
        },
      )
      return subscription
    } catch (error) {
      console.error(
        `Error retrieving expanded subscription ${subscriptionId}:`,
        error,
      )
      throw error
    }
  }
}

export const stripeService = new StripeService()
