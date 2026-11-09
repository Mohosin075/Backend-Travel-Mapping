import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import sendResponse from '../../../shared/sendResponse'
import { IUser } from '../../user/user.interface'
import { ILoginResponse } from '../../../interfaces/response'
import { PassportAuthServices } from './passport.auth.service'
import { AuthCommonServices } from '../common'

import config from '../../../config'

const login = catchAsync(async (req: Request, res: Response) => {
  const user = req.user
  const { deviceToken, password } = req.body

  const result = await AuthCommonServices.handleLoginLogic(
    { deviceToken, password, email: (user as IUser).email, rememberMe: req.body.rememberMe },
    user as IUser,
  )
  const { status, message, accessToken, refreshToken, role, needPassword, passwordSetupRequired } =
    result

  if (refreshToken) {
    res.cookie('refreshToken', refreshToken, {
      secure: config.node_env === 'production',
      httpOnly: true,
      sameSite: config.node_env === 'production' ? 'none' : 'lax',
    })
  }

  sendResponse<ILoginResponse>(res, {
    statusCode: status,
    success: true,
    message: message,
    data: { accessToken, refreshToken, role, needPassword, passwordSetupRequired },
  })
})

const googleAuthCallback = catchAsync(async (req: Request, res: Response) => {
  const result = await PassportAuthServices.handleGoogleLogin(
    req.user as IUser & { profile: any },
  )
  const { accessToken, refreshToken } = result

  // Set refresh cookie on API domain so FE credentials:include refresh works
  if (refreshToken) {
    res.cookie('refreshToken', refreshToken, {
      secure: config.node_env === 'production',
      httpOnly: true,
      sameSite: config.node_env === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
  }

  // Retrieve state parameter (our encoded redirect URL)
  let redirectUrl = `${config.clientUrl}/login?accessToken=${accessToken}&role=${result.role || 'user'}`
  if (req.query.state) {
    try {
      const decodedRedirect = Buffer.from(req.query.state as string, 'base64').toString('ascii')
      if (decodedRedirect.startsWith('/') && !decodedRedirect.startsWith('//') && !decodedRedirect.includes('\\')) {
        redirectUrl += `&redirect=${encodeURIComponent(decodedRedirect)}`
      }
    } catch (e) {
      console.error('Failed to decode OAuth state redirect', e)
    }
  }

  return res.redirect(redirectUrl)
})

export const PassportAuthController = {
  login,
  googleAuthCallback,
}
