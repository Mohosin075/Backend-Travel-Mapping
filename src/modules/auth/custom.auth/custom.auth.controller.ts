import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { CustomAuthServices } from './custom.auth.service'
import sendResponse from '../../../shared/sendResponse'
import { StatusCodes } from 'http-status-codes'
import { TokenServices } from '../../token/token.service'
import { JwtPayload } from 'jsonwebtoken'
import ApiError from '../../../errors/ApiError'

const customLogin = catchAsync(async (req: Request, res: Response) => {
  const { ...loginData } = req.body


  const result = await CustomAuthServices.customLogin(loginData)
  const { status, message, accessToken, refreshToken, role } = result

  res.cookie('refreshToken', refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  })

  sendResponse(res, {
    statusCode: status,
    success: true,
    message: message,
    data: { accessToken, refreshToken, role },
  })
})

const adminLogin = catchAsync(async (req: Request, res: Response) => {
  const { ...loginData } = req.body

  const result = await CustomAuthServices.adminLogin(loginData)
  const { status, message, accessToken, refreshToken, role } = result

  res.cookie('refreshToken', refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  })

  sendResponse(res, {
    statusCode: status,
    success: true,
    message: message,
    data: { accessToken, refreshToken, role },
  })
})

const forgetPassword = catchAsync(async (req: Request, res: Response) => {
  const { email, phone } = req.body
  const result = await CustomAuthServices.forgetPassword(
    email.toLowerCase().trim(),
    phone,
  )
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `An OTP has been sent to your ${email || phone}. Please verify your email.`,
    data: result,
  })
})

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  // Prefer body.token — Authorization is often a logged-in session JWT
  // (prepareHeaders / Bearer) and must not override the reset token.
  const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim()
  const { token: bodyToken, ...resetData } = req.body
  const token = (typeof bodyToken === 'string' && bodyToken.trim()) || headerToken

  if (!token) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You don't have authorization to reset your password, please verify your account first.",
    )
  }

  const result = await CustomAuthServices.resetPassword(token, resetData)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Password reset successfully, please login now.',
    data: result,
  })
})

const verifyAccount = catchAsync(async (req: Request, res: Response) => {
  const { oneTimeCode, phone, email, password } = req.body

  const result = await CustomAuthServices.verifyAccount(
    email,
    oneTimeCode,
    password,
  )
  const { status, message, accessToken, refreshToken, role, token, needPassword } = result

  if (refreshToken) {
    res.cookie('refreshToken', refreshToken, {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    })
  }

  sendResponse(res, {
    statusCode: status,
    success: true,
    message: message,
    data: { accessToken, refreshToken, role, token, needPassword },
  })
})

const getRefreshToken = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.cookies
  const result = await CustomAuthServices.getRefreshToken(refreshToken)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Token refreshed successfully',
    data: result,
  })
})

const resendOtp = catchAsync(async (req: Request, res: Response) => {
  const { email, phone, authType } = req.body
  const result = await CustomAuthServices.resendOtp(email, authType)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `An OTP has been sent to your ${email || phone}. Please verify your email.`,
  })
})

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body
  const result = await CustomAuthServices.changePassword(
    req.user!,
    currentPassword,
    newPassword,
  )
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Password changed successfully',
    data: result,
  })
})

const createUser = catchAsync(async (req: Request, res: Response) => {
  const { ...userData } = req.body
  const result = await CustomAuthServices.createUser(userData)

  res.cookie('email', result.data.email, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    sameSite: 'strict',
  })

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: result.success,
    message: result.message,
    data: result.data,
  })
})
const deleteAccount = catchAsync(async (req: Request, res: Response) => {
  const user = req.user
  const { password } = req.body
  const result = await CustomAuthServices.deleteAccount(user!, password)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Account deleted successfully',
    data: result,
  })
})

const socialLogin = catchAsync(async (req: Request, res: Response) => {
  const { appId, deviceToken } = req.body
  const result = await CustomAuthServices.socialLogin(appId, deviceToken)
  const { status, message, accessToken, refreshToken, role } = result

  res.cookie('refreshToken', refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  })

  sendResponse(res, {
    statusCode: status,
    success: true,
    message: message,
    data: { accessToken, refreshToken, role },
  })
})

const logout = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as JwtPayload).authId
  const result = await TokenServices.logout(userId)

  res.clearCookie('refreshToken')

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Logged out successfully',
    data: result,
  })
})

export const CustomAuthController = {
  forgetPassword,
  resetPassword,
  verifyAccount,
  customLogin,
  getRefreshToken,
  resendOtp,
  changePassword,
  createUser,
  deleteAccount,
  adminLogin,
  socialLogin,
  logout,
}
