"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsRoutes = void 0;
const express_1 = __importDefault(require("express"));
const user_1 = require("../../enum/user");
const auth_1 = __importDefault(require("../../middleware/auth"));
const stats_controller_1 = require("./stats.controller");
const express_rate_limit_1 = require("express-rate-limit");
const router = express_1.default.Router();
const trackingLimit = (0, express_rate_limit_1.rateLimit)({
    windowMs: 60000, limit: 180, standardHeaders: true, legacyHeaders: false,
    // Logged-in visitors sharing a network must not consume each other's heartbeats.
    // Authentication runs first, so this key never trusts an arbitrary body identity.
    keyGenerator: req => {
        var _a;
        const authId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.authId;
        return authId ? `user:${String(authId)}`
            : `guest:${(0, express_rate_limit_1.ipKeyGenerator)(req.ip || req.socket.remoteAddress || 'unknown')}`;
    },
});
const authenticateUsage = (req, res, next) => {
    // Expired account tokens must trigger refresh, never silently become guest views.
    if (req.headers.authorization) {
        void (0, auth_1.default)()(req, res, next);
        return;
    }
    next();
};
router.post('/activity', (0, auth_1.default)(), trackingLimit, stats_controller_1.StatsController.recordActivity);
router.post('/usage', authenticateUsage, trackingLimit, stats_controller_1.StatsController.recordUsage);
router.get('/dashboard', (0, auth_1.default)(user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.MAP_EDITOR), stats_controller_1.StatsController.getDashboardData);
router.get('/reports/search', (0, auth_1.default)(user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), stats_controller_1.StatsController.searchReportEntities);
router.get('/registered-users', (0, auth_1.default)(user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), stats_controller_1.StatsController.getRegisteredUsers);
router.get('/entity-users', (0, auth_1.default)(user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), stats_controller_1.StatsController.getEntityUsers);
router.get('/reports', (0, auth_1.default)(user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), stats_controller_1.StatsController.getReportsData);
exports.StatsRoutes = router;
