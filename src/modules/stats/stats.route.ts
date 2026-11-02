import express from 'express'
import { USER_ROLES } from '../../enum/user'
import auth from '../../middleware/auth'
import { StatsController } from './stats.controller'

const router = express.Router()

router.get(
  '/dashboard',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR),
  StatsController.getDashboardData,
)

router.get(
  '/reports/search',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  StatsController.searchReportEntities,
)

router.get(
  '/entity-users',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR),
  StatsController.getEntityUsers,
)

router.get(
  '/reports',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  StatsController.getReportsData,
)

export const StatsRoutes = router
