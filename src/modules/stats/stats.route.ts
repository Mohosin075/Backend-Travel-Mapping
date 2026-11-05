import express from 'express'
import { USER_ROLES } from '../../enum/user'
import auth from '../../middleware/auth'
import { StatsController } from './stats.controller'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'

const router = express.Router()

const trackingLimit = rateLimit({
  windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false,
  // Logged-in visitors sharing a network must not consume each other's heartbeats.
  // Authentication runs first, so this key never trusts an arbitrary body identity.
  keyGenerator: req => {
    const authId = (req.user as { authId?: string } | undefined)?.authId
    return authId ? `user:${String(authId)}`
      : `guest:${ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown')}`
  },
})
const authenticateUsage: express.RequestHandler = (req, res, next) => {
  // Expired account tokens must trigger refresh, never silently become guest views.
  if (req.headers.authorization) { void auth()(req, res, next); return }
  next()
}
router.post('/activity', auth(), trackingLimit, StatsController.recordActivity)
router.post('/usage', authenticateUsage, trackingLimit, StatsController.recordUsage)

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
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  StatsController.getEntityUsers,
)

router.get(
  '/reports',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  StatsController.getReportsData,
)

export const StatsRoutes = router
