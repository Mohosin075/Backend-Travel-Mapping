import express from 'express'
import auth from '../../middleware/auth'
import validateRequest from '../../middleware/validateRequest'
import { USER_ROLES } from '../../enum/user'
import { PromoValidations } from './promo.validation'
import { PromoControllers } from './promo.controller'

const router = express.Router()

router.get('/verify', PromoControllers.verifyPromoCode)

router.post('/verify-payment',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(PromoValidations.verifyPayment), PromoControllers.verifyPromoPayment)

router.post(
  '/claim',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(PromoValidations.claimPromoZodSchema),
  PromoControllers.claimFreePromo,
)

router.post(
  '/create-checkout-session',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(PromoValidations.createPromoCheckoutSessionZodSchema),
  PromoControllers.createPromoCheckoutSession,
)

router.post(
  '/bulk-generate',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(PromoValidations.bulkGeneratePromoZodSchema),
  PromoControllers.bulkGeneratePromoLinks,
)

router.post(
  '/send-emails',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(PromoValidations.sendBulkEmailsZodSchema),
  PromoControllers.sendBulkPromoEmails,
)

router.get(
  '/stats',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  PromoControllers.getPromoStats,
)

router.get(
  '/',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  PromoControllers.getAllPromoLinks,
)

router.delete(
  '/:id',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  PromoControllers.deletePromoLink,
)

export const PromoLinkRoutes = router
