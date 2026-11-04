import express from 'express'
import auth from '../../middleware/auth'
import validateRequest from '../../middleware/validateRequest'
import { USER_ROLES } from '../../enum/user'
import { MapController } from './map.controller'
import { createMapZodSchema, updateMapZodSchema } from './map.validation'
import { fileAndBodyProcessorUsingDiskStorage } from '../../middleware/processReqBody'

const router = express.Router()

router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileAndBodyProcessorUsingDiskStorage(),
    validateRequest(createMapZodSchema),
    MapController.createMap
  )
  .get(MapController.getAllMaps)

router.get(
  '/purchased/all',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  MapController.getPurchasedMaps
)

router.get('/manage', auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR), MapController.getManagedMaps)

router.get('/available-countries', MapController.getAvailableCountries)
router.get('/discovery', MapController.getDiscoveryData)
router.post('/:id/view', MapController.incrementViewCount)

router
  .route('/:id')
  .get(MapController.getMapById)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR),
    fileAndBodyProcessorUsingDiskStorage(),
    validateRequest(updateMapZodSchema),
    MapController.updateMap
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    MapController.deleteMap
  )

router.post(
  '/:id/purchase',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  MapController.purchaseMap
)

export const MapRoutes = router
