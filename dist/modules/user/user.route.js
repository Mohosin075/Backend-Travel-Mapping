"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRoutes = void 0;
const express_1 = __importDefault(require("express"));
const user_controller_1 = require("./user.controller");
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const auth_1 = __importDefault(require("../../middleware/auth"));
const user_1 = require("../../enum/user");
const user_validation_1 = require("./user.validation");
const processReqBody_1 = require("../../middleware/processReqBody");
const router = express_1.default.Router();
router.get('/profile', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.MAP_EDITOR), user_controller_1.UserController.getProfile);
router.get('/public/:userId', user_controller_1.UserController.getPublicProfile);
router.post('/interest', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(user_validation_1.addUserInterestSchema), user_controller_1.UserController.addUserInterest);
router.post('/toggle-favorite-map/:mapId', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(user_validation_1.favoriteMapSchema), user_controller_1.UserController.toggleFavoriteMap);
router.get('/favorite-maps', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), user_controller_1.UserController.getFavoriteMaps);
router.post('/favorite-offer/:offerId', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(user_validation_1.favoriteOfferSchema), user_controller_1.UserController.toggleFavoriteOffer);
router.get('/favorite-offers', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), user_controller_1.UserController.getFavoriteOffers);
router.patch('/profile', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.MAP_EDITOR), (0, processReqBody_1.fileAndBodyProcessorUsingDiskStorage)(), (0, validateRequest_1.default)(user_validation_1.updateUserSchema), user_controller_1.UserController.updateProfile);
router.post('/invite', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(user_validation_1.inviteUserSchema), user_controller_1.UserController.inviteUser);
router.patch('/update-role/:userId', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(user_validation_1.updateUserRoleSchema), user_controller_1.UserController.updateUserRole);
router.patch('/assign-editor-access/:userId', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(user_validation_1.assignEditorAccessZodSchema), user_controller_1.UserController.assignEditorAccess);
router.patch('/map-access/:userId', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(user_validation_1.updateUserMapAccessSchema), user_controller_1.UserController.updateUserMapAccess);
router.delete('/profile', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.USER, user_1.USER_ROLES.MAP_EDITOR), user_controller_1.UserController.deleteProfile);
router
    .route('/')
    .get((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), user_controller_1.UserController.getAllUsers);
router
    .route('/:userId')
    .get((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.USER), user_controller_1.UserController.getUserById)
    .delete((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), user_controller_1.UserController.deleteUser)
    .patch((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), 
// validateRequest(updateUserSchema),
user_controller_1.UserController.updateUserStatus);
exports.UserRoutes = router;
