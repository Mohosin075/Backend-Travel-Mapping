"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfferRoutes = void 0;
const express_1 = __importDefault(require("express"));
const offer_controller_1 = require("./offer.controller");
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const offer_validation_1 = require("./offer.validation");
const auth_1 = __importDefault(require("../../middleware/auth"));
const user_1 = require("../../enum/user");
const processReqBody_1 = require("../../middleware/processReqBody");
const router = express_1.default.Router();
router.get('/managed', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.MAP_EDITOR), offer_controller_1.OfferController.getManagedOffers);
router.get('/by-place-or-business/:id', offer_controller_1.OfferController.getOffersByPlaceOrBusinessId);
router.get('/by-place-or-business/:id/redemptions', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.USER, user_1.USER_ROLES.MAP_EDITOR), offer_controller_1.OfferController.getOfferRedemptions);
router
    .route('/')
    .post((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.USER, user_1.USER_ROLES.MAP_EDITOR), (0, processReqBody_1.fileAndBodyProcessorUsingDiskStorage)(), (0, validateRequest_1.default)(offer_validation_1.createOfferZodSchema), offer_controller_1.OfferController.createOffer)
    .get(offer_controller_1.OfferController.getAllOffers);
router
    .route('/:id')
    .get(offer_controller_1.OfferController.getOfferById)
    .patch((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.MAP_EDITOR, user_1.USER_ROLES.USER), (0, processReqBody_1.fileAndBodyProcessorUsingDiskStorage)(), (0, validateRequest_1.default)(offer_validation_1.updateOfferZodSchema), offer_controller_1.OfferController.updateOffer)
    .delete((0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), offer_controller_1.OfferController.deleteOffer);
router.post('/:id/calculate', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.USER), offer_controller_1.OfferController.calculateDiscount);
router.post('/:id/redeem', (0, auth_1.default)(user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.USER), offer_controller_1.OfferController.redeemOffer);
exports.OfferRoutes = router;
