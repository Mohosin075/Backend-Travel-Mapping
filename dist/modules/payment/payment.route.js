"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentRoutes = void 0;
const express_1 = __importDefault(require("express"));
const payment_controller_1 = require("./payment.controller");
const payment_validation_1 = require("./payment.validation");
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const auth_1 = __importDefault(require("../../middleware/auth"));
const user_1 = require("../../enum/user");
const rateLimit_1 = require("../../middleware/rateLimit");
const guest_checkout_controller_1 = require("./guest-checkout.controller");
const router = express_1.default.Router();
router.post('/guest/start', rateLimit_1.authRateLimiter, guest_checkout_controller_1.GuestCheckoutController.start);
router.post('/guest/complete', rateLimit_1.authRateLimiter, guest_checkout_controller_1.GuestCheckoutController.complete);
router.get('/', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), payment_controller_1.PaymentController.getAllPayments);
router.get('/my-payments', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), payment_controller_1.PaymentController.getMyPayments);
router.get('/:id', (0, auth_1.default)(user_1.USER_ROLES.USER), payment_controller_1.PaymentController.getSinglePayment);
router.get('/:id/invoice', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), payment_controller_1.PaymentController.generateInvoice);
// ✅ ONLY THIS - Checkout Session
router.post('/create-checkout-session', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN), (0, validateRequest_1.default)(payment_validation_1.PaymentValidations.create), payment_controller_1.PaymentController.createCheckoutSession);
router.get('/verify-checkout/:sessionId', payment_controller_1.PaymentController.verifyCheckoutSession);
// ============================================
// FLUTTER STRIPE ROUTES
// ============================================
router.post('/create-payment-intent', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), (0, validateRequest_1.default)(payment_validation_1.PaymentValidations.create), payment_controller_1.PaymentController.createPaymentIntent);
//Add SUPER_ADMIN role protection to the ephemeral-key route for enhanced security
router.post('/ephemeral-key', (0, auth_1.default)(user_1.USER_ROLES.USER, user_1.USER_ROLES.SUPER_ADMIN), payment_controller_1.PaymentController.createEphemeralKey);
// ============================================
// EXISTING ROUTES
// ============================================
router.patch('/:id', (0, auth_1.default)(user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), (0, validateRequest_1.default)(payment_validation_1.PaymentValidations.update), payment_controller_1.PaymentController.updatePayment);
router.post('/:id/refund', (0, auth_1.default)(user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.ADMIN), payment_controller_1.PaymentController.refundPayment);
exports.PaymentRoutes = router;
