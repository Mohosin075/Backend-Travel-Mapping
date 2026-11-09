import { StatusCodes } from 'http-status-codes'
import { ILoginData } from '../../interfaces/auth'
import ApiError from '../../errors/ApiError'
import { USER_STATUS } from '../../enum/user'
import { User } from '../user/user.model'
import { AuthHelper } from './auth.helper'
import { generateOtp } from '../../utils/crypto'
import { IAuthResponse } from './auth.interface'
import { IUser } from '../user/user.interface'
import { emailTemplate } from '../../shared/emailTemplate'
import { emailHelper } from '../../helpers/emailHelper'
// import { emailQueue } from '../../helpers/bull-mq-producer'

const handleLoginLogic = async (
  payload: ILoginData,
  isUserExist: IUser,
): Promise<IAuthResponse> => {
  const { authentication, verified, status, password } = isUserExist

  const { restrictionLeftAt, wrongLoginAttempts } = authentication

  if (status === USER_STATUS.DELETED) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'No account found with this email',
    )
  }

  if (status === USER_STATUS.INACTIVE) {
    if (restrictionLeftAt && new Date() < restrictionLeftAt) {
      const remainingMinutes = Math.ceil(
        (restrictionLeftAt.getTime() - Date.now()) / 60000,
      )
      throw new ApiError(
        StatusCodes.TOO_MANY_REQUESTS,
        `You are restricted to login for ${remainingMinutes} minutes`,
      )
    }

    // Handle restriction expiration
    await User.findByIdAndUpdate(isUserExist._id, {
      $set: {
        'authentication.restrictionLeftAt': null,
        'authentication.wrongLoginAttempts': 0,
        status: USER_STATUS.ACTIVE,
      },
    })
  }

  if (!password && isUserExist.provider === 'guest_purchase') {
    return {
      status: StatusCodes.OK,
      message: "You haven't set a password yet. Verify your email to set one.",
      passwordSetupRequired: true,
    }
  }
  if (!password && verified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This account has no password. Continue with Google or verify your email to set a password.')
  }

  // Existing password accounts must prove their password before receiving a
  // signup verification redirect. Passwordless invitations keep their OTP flow.
  const isPasswordMatched = !password || await User.isPasswordMatched(
    payload.password,
    password,
  )

  if (!isPasswordMatched) {
    isUserExist.authentication.wrongLoginAttempts = wrongLoginAttempts + 1

    if (isUserExist.authentication.wrongLoginAttempts >= 5) {
      isUserExist.status = USER_STATUS.INACTIVE
      isUserExist.authentication.restrictionLeftAt = new Date(
        Date.now() + 10 * 60 * 1000,
      ) // restriction for 10 minutes
    }

    await User.findByIdAndUpdate(isUserExist._id, {
      $set: {
        status: isUserExist.status,
        'authentication.restrictionLeftAt':
          isUserExist.authentication.restrictionLeftAt,
        'authentication.wrongLoginAttempts':
          isUserExist.authentication.wrongLoginAttempts,
      },
    })

    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Incorrect password, please try again.',
    )
  }

  if (!verified) {
    const isInviteAccept = !password
    const otp = generateOtp()
    const otpExpiresIn = new Date(Date.now() + (isInviteAccept ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000))
    await User.findByIdAndUpdate(isUserExist._id, { $set: { authentication: {
      email: isUserExist.email, oneTimeCode: otp, expiresAt: otpExpiresIn,
      latestRequestAt: new Date(), authType: 'createAccount',
    } } })
    const template = isInviteAccept
      ? emailTemplate.userInvitation({ email: isUserExist.email!, role: isUserExist.role || 'user', otp })
      : emailTemplate.createAccount({ name: isUserExist.name || 'there', email: isUserExist.email!, otp })
    emailHelper.sendEmail(template)
    return authResponse(StatusCodes.OK, `An OTP has been sent to your ${isUserExist.email}. Please verify.`,
      undefined, undefined, undefined, undefined, isInviteAccept)
  }

  await User.findByIdAndUpdate(
    isUserExist._id,
    {
      $set: {
        deviceToken: payload.deviceToken,
        'authentication.restrictionLeftAt': null,
        'authentication.wrongLoginAttempts': 0,
      },
    },
    { new: true },
  )
  const rememberMe = payload.rememberMe || false

  const tokens = AuthHelper.createToken(
    isUserExist._id,
    isUserExist.role,
    isUserExist.name,
    isUserExist.email,
    payload.deviceToken,
    rememberMe,
  )

  return authResponse(
    StatusCodes.OK,
    `Welcome back ${isUserExist.name}`,
    isUserExist.role,
    tokens.accessToken,
    tokens.refreshToken,
  )
}

export const AuthCommonServices = {
  handleLoginLogic,
}

export const authResponse = (
  status: number,
  message: string,
  role?: string,
  accessToken?: string,
  refreshToken?: string,
  token?: string,
  needPassword?: boolean,
): IAuthResponse => {
  return {
    status,
    message,
    ...(role && { role }),
    ...(accessToken && { accessToken }),
    ...(refreshToken && { refreshToken }),
    ...(token && { token }),
    ...(needPassword !== undefined && { needPassword }),
  }
}
