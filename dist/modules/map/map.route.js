"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapRoutes = void 0;
const express_1 = __importDefault(require("express"));
const auth_1 = __importDefault(require("../../middleware/auth"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const user_1 = require("../../enum/user");
const map_controller_1 = require("./map.controller");
const map_validation_1 = require("./map.validation");
const processReqBody_1 = require("../../middleware/processReqBody");
const router = express_1.default.Router();
router
    .route('/')
    .post((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, processReqBody_1.fileAndBodyProcessorUsingDiskStorage)(), (0, validateRequest_1.default)(map_validation_1.createMapZodSchema), map_controller_1.MapController.createMap)
    .get(map_controller_1.MapController.getAllMaps);
router.get('/purchased/all', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), map_controller_1.MapController.getPurchasedMaps);
router.get('/manage', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.MAP_EDITOR), map_controller_1.MapController.getManagedMaps);
router.get('/available-countries', map_controller_1.MapController.getAvailableCountries);
router.get('/discovery', map_controller_1.MapController.getDiscoveryData);
router.post('/:id/view', map_controller_1.MapController.incrementViewCount);
router
    .route('/:id')
    .get(map_controller_1.MapController.getMapById)
    .patch((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.MAP_EDITOR), (0, processReqBody_1.fileAndBodyProcessorUsingDiskStorage)(), (0, validateRequest_1.default)(map_validation_1.updateMapZodSchema), map_controller_1.MapController.updateMap)
    .delete((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), map_controller_1.MapController.deleteMap);
router.post('/:id/purchase', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), map_controller_1.MapController.purchaseMap);
exports.MapRoutes = router;
