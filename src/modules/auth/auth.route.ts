import express from 'express'
import passport from 'passport'
import { PassportAuthController } from './passport.auth/passport.auth.controller'
import { CustomAuthController } from './custom.auth/custom.auth.controller'
import validateRequest from '../../middleware/validateRequest'
import { AuthValidations } from './auth.validation'
import { USER_ROLES } from '../../enum/user'
import auth from '../../middleware/auth'
import {
  authRateLimiter,
  otpRateLimiter,
  otpIpRateLimiter,
  otpSendRateLimiter,
  passwordRateLimiter,
  refreshTokenRateLimiter,
} from '../../middleware/rateLimit'

const router = express.Router()

router.post(
  '/signup',
  authRateLimiter,
  validateRequest(AuthValidations.createUserZodSchema),
  CustomAuthController.createUser,
)
router.post(
  '/admin-login',
  authRateLimiter,
  validateRequest(AuthValidations.loginZodSchema),
  CustomAuthController.adminLogin,
)
router.post(
  '/login',
  authRateLimiter,
  validateRequest(AuthValidations.loginZodSchema),
  passport.authenticate('local', { session: false }),
  PassportAuthController.login,
)

router.get(
  '/google',
  authRateLimiter,
  (req, res, next) => {
    const redirect = req.query.redirect as string;
    const state = redirect ? Buffer.from(redirect).toString('base64') : '';
    passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
  }
)

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false }),
  PassportAuthController.googleAuthCallback,
)

router.post(
  '/verify-account',
  otpIpRateLimiter,
  otpRateLimiter,
  validateRequest(AuthValidations.verifyAccountZodSchema),
  CustomAuthController.verifyAccount,
)

router.post(
  '/custom-login',
  authRateLimiter,
  validateRequest(AuthValidations.loginZodSchema),
  CustomAuthController.customLogin,
)

router.post(
  '/forget-password',
  otpIpRateLimiter,
  otpSendRateLimiter,
  validateRequest(AuthValidations.forgetPasswordZodSchema),
  CustomAuthController.forgetPassword,
)
router.post(
  '/reset-password',
  passwordRateLimiter,
  validateRequest(AuthValidations.resetPasswordZodSchema),
  CustomAuthController.resetPassword,
)

router.post(
  '/resend-otp',
  otpIpRateLimiter,
  otpSendRateLimiter,
  validateRequest(AuthValidations.resendOtpZodSchema),
  CustomAuthController.resendOtp,
)

router.post(
  '/change-password',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.MAP_EDITOR),
  passwordRateLimiter,
  validateRequest(AuthValidations.changePasswordZodSchema),
  CustomAuthController.changePassword,
)

router.delete(
  '/delete-account',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.MAP_EDITOR),
  validateRequest(AuthValidations.deleteAccount),
  CustomAuthController.deleteAccount,
)
router.post(
  '/refresh-token',
  refreshTokenRateLimiter,
  CustomAuthController.getRefreshToken,
)

router.post(
  '/social-login',
  authRateLimiter,
  validateRequest(AuthValidations.socialLoginZodSchema),
  CustomAuthController.socialLogin,
)

router.post(
  '/logout',
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.MAP_EDITOR),
  CustomAuthController.logout,
)

export const AuthRoutes = router
