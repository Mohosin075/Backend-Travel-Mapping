import express from 'express'
import { UserController } from './user.controller'
import validateRequest from '../../middleware/validateRequest'
import auth from '../../middleware/auth'
import { USER_ROLES } from '../../enum/user'
import ApiError from '../../errors/ApiError'
import { StatusCodes } from 'http-status-codes'
import { S3Helper } from '../../helpers/image/s3helper'
import fileUploadHandler from '../../middleware/fileUploadHandler'
import {
  addUserInterestSchema,
  createStaffSchema,
  favoriteOfferSchema,
  favoriteMapSchema,
  updateUserSchema,
  inviteUserSchema,
  updateUserRoleSchema,
  assignEditorAccessZodSchema,
  updateUserMapAccessSchema,
} from './user.validation'
import { fileAndBodyProcessorUsingDiskStorage } from '../../middleware/processReqBody'

const router = express.Router()

router.get(
  '/profile',
  auth(USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR),
  UserController.getProfile,
)

router.get('/public/:userId', UserController.getPublicProfile)

router.post(
  '/interest',
  auth(USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.SUPER_ADMIN),
  validateRequest(addUserInterestSchema),
  UserController.addUserInterest,
)

router.post(
  '/toggle-favorite-map/:mapId',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(favoriteMapSchema),
  UserController.toggleFavoriteMap,
)

router.get(
  '/favorite-maps',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserController.getFavoriteMaps,
)

router.post(
  '/favorite-offer/:offerId',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(favoriteOfferSchema),
  UserController.toggleFavoriteOffer,
)

router.get(
  '/favorite-offers',
  auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserController.getFavoriteOffers,
)

router.patch(
  '/profile',
  auth(USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR),

  fileAndBodyProcessorUsingDiskStorage(),

  validateRequest(updateUserSchema),
  UserController.updateProfile,
)

router.post(
  '/invite',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(inviteUserSchema),
  UserController.inviteUser,
)

router.patch(
  '/update-role/:userId',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(updateUserRoleSchema),
  UserController.updateUserRole,
)

router.patch(
  '/assign-editor-access/:userId',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(assignEditorAccessZodSchema),
  UserController.assignEditorAccess,
)

router.patch(
  '/map-access/:userId',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(updateUserMapAccessSchema),
  UserController.updateUserMapAccess,
)

router.delete(
  '/profile',
  auth(
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.USER,
    USER_ROLES.MAP_EDITOR,
  ),
  UserController.deleteProfile,
)

router
  .route('/')
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    UserController.getAllUsers,
  )

router
  .route('/:userId')
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.USER),
    UserController.getUserById,
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    UserController.deleteUser,
  )
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    // validateRequest(updateUserSchema),
    UserController.updateUserStatus,
  )

export const UserRoutes = router
