import express from 'express'
import { PaymentController } from './payment.controller'
import { PaymentValidations } from './payment.validation'
import validateRequest from '../../middleware/validateRequest'
import auth from '../../middleware/auth'
import { USER_ROLES } from '../../enum/user'
import { authRateLimiter } from '../../middleware/rateLimit'
import { GuestCheckoutController } from './guest-checkout.controller'

const router = express.Router()

router.post('/guest/start', authRateLimiter, GuestCheckoutController.start)
router.post('/guest/complete', authRateLimiter, GuestCheckoutController.complete)

router.get(
  '/',
  auth(
    
    USER_ROLES.USER,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.ADMIN,
  ),
  PaymentController.getAllPayments,
)

router.get(
  '/my-payments',
  auth(
    
    USER_ROLES.USER,
        USER_ROLES.SUPER_ADMIN,
    USER_ROLES.ADMIN,
  ),
  PaymentController.getMyPayments,
)

router.get(
  '/:id',
  auth(
    
    USER_ROLES.USER,
  ),
  PaymentController.getSinglePayment,
)

router.get(
  '/:id/invoice',
  auth(
    
    USER_ROLES.USER,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.ADMIN,
  ),
  PaymentController.generateInvoice,
)

// ✅ ONLY THIS - Checkout Session
router.post(
  '/create-checkout-session',
  auth(
    USER_ROLES.USER,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN
  ),
  validateRequest(PaymentValidations.create),
  PaymentController.createCheckoutSession,
)

router.get(
  '/verify-checkout/:sessionId',
  PaymentController.verifyCheckoutSession,
)

// ============================================
// FLUTTER STRIPE ROUTES
// ============================================

router.post(
  '/create-payment-intent',
  auth(
    
    USER_ROLES.USER,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.ADMIN,
  ),
  validateRequest(PaymentValidations.create),
  PaymentController.createPaymentIntent,
)

//Add SUPER_ADMIN role protection to the ephemeral-key route for enhanced security
router.post(
  '/ephemeral-key',
  auth(
    
    USER_ROLES.USER,
    USER_ROLES.SUPER_ADMIN,
  ),
  PaymentController.createEphemeralKey,
)

// ============================================
// EXISTING ROUTES
// ============================================



router.patch(
  '/:id',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  validateRequest(PaymentValidations.update),
  PaymentController.updatePayment,
)

router.post(
  '/:id/refund',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  PaymentController.refundPayment,
)

export const PaymentRoutes = router
