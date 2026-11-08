import express from 'express'
import { OfferController } from './offer.controller'
import validateRequest from '../../middleware/validateRequest'
import {
  createOfferZodSchema,
  updateOfferZodSchema,
} from './offer.validation'
import auth from '../../middleware/auth'
import { USER_ROLES } from '../../enum/user'
import { fileAndBodyProcessorUsingDiskStorage } from '../../middleware/processReqBody'

const router = express.Router()

router.get(
  '/managed',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR),
  OfferController.getManagedOffers,
)

router.get(
  '/by-place-or-business/:id',
  OfferController.getOffersByPlaceOrBusinessId,
)

router.get(
  '/by-place-or-business/:id/redemptions',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.USER, USER_ROLES.MAP_EDITOR),
  OfferController.getOfferRedemptions,
)


router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.USER, USER_ROLES.MAP_EDITOR),
    fileAndBodyProcessorUsingDiskStorage(),
    validateRequest(createOfferZodSchema),
    OfferController.createOffer,
  )
  .get(OfferController.getAllOffers)



router
  .route('/:id')
  .get(OfferController.getOfferById)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR, USER_ROLES.USER),
    fileAndBodyProcessorUsingDiskStorage(),
    validateRequest(updateOfferZodSchema),
    OfferController.updateOffer,
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    OfferController.deleteOffer,
  )

router.post(
  '/:id/calculate',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.USER),
  OfferController.calculateDiscount,
)

router.post(
  '/:id/redeem',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.USER),
  OfferController.redeemOffer,
)

export const OfferRoutes = router
