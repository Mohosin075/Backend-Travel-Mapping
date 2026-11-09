import { StatusCodes } from 'http-status-codes'
import { User } from '../../user/user.model'
import { AuthHelper } from '../auth.helper'
import ApiError from '../../../errors/ApiError'
import { USER_ROLES, USER_STATUS } from '../../../enum/user'
import config from '../../../config'
import { Token } from '../../token/token.model'
import { IAuthResponse, IResetPassword } from '../auth.interface'
import { emailTemplate } from '../../../shared/emailTemplate'
import cryptoToken, { generateOtp } from '../../../utils/crypto'
import bcrypt from 'bcrypt'
import { ILoginData } from '../../../interfaces/auth'
import { AuthCommonServices, authResponse } from '../common'
import { jwtHelper } from '../../../helpers/jwtHelper'
import { JwtPayload } from 'jsonwebtoken'
import { IUser } from '../../user/user.interface'
import { emailHelper } from '../../../helpers/emailHelper'
// import { emailQueue } from '../../../helpers/bull-mq-producer'

const createUser = async (payload: IUser) => {
  payload.email = payload.email?.toLowerCase().trim()
  const isUserExist = await User.findOne({
    email: payload.email,
    status: { $nin: [USER_STATUS.DELETED] },
  })

  if (isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `An account with this email already exist, please login or try with another email.`,
    )
  }

  const otp = generateOtp()
  const otpExpiresIn = new Date(Date.now() + 5 * 60 * 1000)

  const authentication = {
    email: payload.email,
    oneTimeCode: otp,
    expiresAt: otpExpiresIn,
    latestRequestAt: new Date(),
    requestCount: 1,
    authType: 'createAccount',
    isVerified: false,
  }

  // Send email with OTP
  const createAccount = emailTemplate.createAccount({
    name: payload.name!,
    email: payload.email!.toLowerCase().trim(),
    otp,
  })

  emailHelper.sendEmail(createAccount)

  const user = await User.create({
    ...payload,
    password: payload.password,
    authentication,
  })

  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create user.')
  }

  return {
    success: true,
    message: 'Registration successful and OTP sent to your email',
    data: {
      email: user.email,
    },
  }
}

const customLogin = async (payload: ILoginData): Promise<IAuthResponse> => {
  const { email, phone } = payload
  const query = email ? { email: email.toLowerCase().trim() } : { phone: phone }

  const isUserExist = await User.findOne({
    ...query,
    status: { $in: [USER_STATUS.ACTIVE] },
  })
    .select('+password +authentication')
    .lean()
  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `No account found with this ${email ? 'email' : 'phone'}`,
    )
  }

  if (!isUserExist.password && isUserExist.provider !== 'guest_purchase') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'It seems you have signed up using social login. Please use social login to access your account.',
    )
  }

  const result = await AuthCommonServices.handleLoginLogic(payload, isUserExist)

  return result
}

const adminLogin = async (payload: ILoginData): Promise<IAuthResponse> => {
  const { email, phone } = payload
  const query = email ? { email: email.trim().toLowerCase() } : { phone: phone }

  const isUserExist = await User.findOne({
    ...query,
  })
    .select('+password +authentication')
    .lean()
  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `No account found with this ${email ? 'email' : 'phone'}`,
    )
  }

  if (isUserExist.role !== USER_ROLES.ADMIN) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You are not authorized to login as admin',
    )
  }

  const isPasswordMatch = await AuthHelper.isPasswordMatched(
    payload.password,
    isUserExist.password as string,
  )
  if (!isPasswordMatch) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      'Please try again with correct credentials.',
    )
  }

  //tokens
  const tokens = AuthHelper.createToken(
    isUserExist._id,
    isUserExist.role,
    isUserExist.name!,
    isUserExist.email!,
  )

  return authResponse(
    StatusCodes.OK,
    `Welcome back ${isUserExist.name}`,
    isUserExist.role,
    tokens.accessToken,
    tokens.refreshToken,
  )
}

const forgetPassword = async (email?: string, phone?: string) => {
  const query = email
    ? { email: email.toLocaleLowerCase().trim() }
    : { phone: phone }
  const isUserExist = await User.findOne({
    ...query,
    status: { $in: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE] },
  })

  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'No account found with this email or phone',
    )
  }

  const otp = generateOtp()

  if (phone) {
    // implement SMS OTP via SMS provider if needed
  }

  const authentication = {
    email: isUserExist.email,
    resetPassword: true,
    oneTimeCode: otp,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    latestRequestAt: new Date(),
    requestCount: 1,
    authType: 'resetPassword',
  }

  await User.findByIdAndUpdate(
    isUserExist._id,
    {
      $set: { authentication: authentication },
    },
    { new: true },
  )

  // //send otp to user
  if (email) {
    const forgetPasswordEmailTemplate = emailTemplate.resetPassword({
      name: isUserExist.name || 'viajero',
      email: isUserExist.email as string,
      otp,
      isSetup: !isUserExist.password,
    })

    emailHelper.sendEmail(forgetPasswordEmailTemplate)
  }

  return 'OTP sent successfully.'
}

const resetPassword = async (resetToken: string, payload: IResetPassword) => {
  const { newPassword, confirmPassword } = payload
  if (newPassword !== confirmPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match')
  }

  const isTokenExist = await Token.findOne({ token: resetToken }).lean()

  if (!isTokenExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You don't have authorization to reset your password, please verify your account first.",
    )
  }

  const isUserExist = await User.findById(isTokenExist.user)
    .select('+authentication')
    .lean()

  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Something went wrong, please try again. or contact support.',
    )
  }

  const { authentication } = isUserExist
  if (!authentication?.resetPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You don\'t have permission to change the password. Please click again to "Forgot Password"',
    )
  }

  const isTokenValid = isTokenExist?.expireAt > new Date()
  if (!isTokenValid) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Your reset token has expired, please try again.',
    )
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  )
  const updatedUserData = {
    password: hashPassword,
    verified: true, // Mark as verified when setting password for the first time
    authentication: {
      resetPassword: false,
      otp: '',
      expiresAt: null,
      latestRequestAt: null,
      requestCount: 0,
      authType: '',
    },
  }

  const consumedToken = await Token.findOneAndDelete({ token: resetToken, user: isUserExist._id,
    expireAt: { $gt: new Date() } })
  if (!consumedToken) throw new ApiError(StatusCodes.BAD_REQUEST, 'This reset token was already used or expired. Please request a new code.')

  await User.findByIdAndUpdate(
    isUserExist._id,
    { $set: updatedUserData },
    { new: true },
  )

  return { message: 'Password reset successfully' }
}

const verifyAccount = async (
  email: string,
  onetimeCode: string,
  password?: string,
): Promise<IAuthResponse> => {
  //verify fo new user
  if (!onetimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'OTP is required.')
  }
  const isUserExist = await User.findOne({
    email: email.toLowerCase().trim(),
    status: { $nin: [USER_STATUS.DELETED] },
  }).select('+password +authentication')

  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `No account found with this ${email}, please register first.`,
    )
  }

  const { authentication } = isUserExist

  // Normalize: digits only (handles number/string and stray whitespace)
  const storedOtp = String(authentication?.oneTimeCode ?? '').replace(/\D/g, '')
  const providedOtp = String(onetimeCode ?? '').replace(/\D/g, '')

  if (!storedOtp) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'No active code found. Please use Resend Code or request a new invitation.',
    )
  }

  if (storedOtp !== providedOtp) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Invalid or outdated code. Use the code from your latest email, or tap Resend Code.',
    )
  }

  const currentDate = new Date()
  if (!authentication?.expiresAt || new Date(authentication.expiresAt).getTime() <= currentDate.getTime()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'OTP has expired, please try again.',
    )
  }

  // Consume the code atomically before any account/login/reset-token action.
  // A signup verification code must not be replayable as a password-reset code.
  const consumed = await User.findOneAndUpdate({
    _id: isUserExist._id,
    status: { $nin: [USER_STATUS.DELETED] },
    'authentication.oneTimeCode': authentication.oneTimeCode,
    'authentication.expiresAt': { $gt: currentDate },
  }, { $set: { 'authentication.oneTimeCode': '' } }, { new: true })
  if (!consumed) throw new ApiError(StatusCodes.BAD_REQUEST, 'This code was already used or expired. Please request a new code.')

  //either newly created user or existing user
  if (!isUserExist.verified && authentication.authType !== 'resetPassword' && !authentication.resetPassword) {
    // If user was invited (has no password), they must set a password first
    if (!isUserExist.password) {
      if (password) {
        // If password is provided during OTP verification (Invitation acceptance)
        isUserExist.password = password
        isUserExist.verified = true
        isUserExist.authentication = {
          oneTimeCode: '',
          expiresAt: null,
          latestRequestAt: null,
          requestCount: 0,
          authType: 'createAccount',
          resetPassword: false,
        } as any

        await isUserExist.save()

        const tokens = AuthHelper.createToken(
          isUserExist._id,
          isUserExist.role,
          isUserExist.name!,
          isUserExist.email!,
        )

        return authResponse(
          StatusCodes.OK,
          `Welcome ${isUserExist.name} to our platform. Your account is now verified and password set.`,
          isUserExist.role,
          tokens.accessToken,
          tokens.refreshToken,
        )
      } else {
        // If password is NOT provided, return the reset token to set password
        await User.findByIdAndUpdate(
          isUserExist._id,
          {
            $set: {
              authentication: {
                oneTimeCode: '',
                expiresAt: null,
                latestRequestAt: null,
                requestCount: 0,
                authType: '',
                resetPassword: true,
              },
            },
          },
          { new: true },
        )

        const token = await Token.create({
          token: cryptoToken(),
          user: isUserExist._id,
          expireAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        })

        return authResponse(
          StatusCodes.OK,
          'OTP verified successfully, please set your password to complete your account.',
          undefined,
          undefined,
          undefined,
          token?.token,
          true, // needPassword
        )
      }
    }

    // Normal signup flow (already has password)
    await User.findByIdAndUpdate(
      isUserExist._id,
      { $set: { verified: true } },
      { new: true },
    )

    const tokens = AuthHelper.createToken(
      isUserExist._id,
      isUserExist.role,
      isUserExist.name!,
      isUserExist.email!,
    )


    return authResponse(
      StatusCodes.OK,
      `Welcome ${isUserExist.name} to our platform.`,
      isUserExist.role,
      tokens.accessToken,
      tokens.refreshToken,
    )
  } else {
    await User.findByIdAndUpdate(
      isUserExist._id,
      {
        $set: {
          authentication: {
            oneTimeCode: '',
            expiresAt: null,
            latestRequestAt: null,
            requestCount: 0,
            authType: '',
            resetPassword: true,
          },
        },
      },
      { new: true },
    )

    const token = await Token.create({
      token: cryptoToken(),
      user: isUserExist._id,
      expireAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    })

    if (!token) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Something went wrong, please try again. or contact support.',
      )
    }

    return authResponse(
      StatusCodes.OK,
      'OTP verified successfully, please reset your password.',
      undefined,
      undefined,
      undefined,
      token?.token,
      true, // needPassword — frontend uses this to route to reset-password
    )
  }
}

const getRefreshToken = async (token: string) => {
  try {
    const decodedToken = jwtHelper.verifyToken(
      token,
      config.jwt.jwt_refresh_secret as string,
    )

    // Current tokens use authId; retain support for older userId tokens.
    const userId = decodedToken.authId || decodedToken.userId
    if (!userId) throw new ApiError(StatusCodes.FORBIDDEN, 'Invalid Refresh Token')
    const currentUser = await User.findById(userId)
    if (!currentUser || currentUser.status !== USER_STATUS.ACTIVE) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'This account is no longer active. Please sign in again.')
    }

    const tokens = AuthHelper.createToken(
      userId,
      currentUser.role,
      currentUser.name,
      currentUser.email,
    )

    return {
      accessToken: tokens.accessToken,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Refresh Token has expired')
    }
    throw new ApiError(StatusCodes.FORBIDDEN, 'Invalid Refresh Token')
  }
}

const socialLogin = async (
  appId: string,
  deviceToken: string,
): Promise<IAuthResponse> => {
  const isUserExist = await User.findOne({
    appId,
    status: { $in: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE] },
  })
  if (!isUserExist) {
    const createdUser = await User.create({
      appId,
      deviceToken,
      status: USER_STATUS.ACTIVE,
      password: crypto.randomUUID(),
    })
    if (!createdUser)
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create user.')
    const tokens = AuthHelper.createToken(
      createdUser._id,
      createdUser.role,
      createdUser.name,
      createdUser.email,
    )
    return authResponse(
      StatusCodes.OK,
      `Welcome ${createdUser.name} to our platform.`,
      createdUser.role,
      tokens.accessToken,
      tokens.refreshToken,
    )
  } else {
    await User.findByIdAndUpdate(isUserExist._id, {
      $set: {
        deviceToken,
      },
    })

    const tokens = AuthHelper.createToken(
      isUserExist._id,
      isUserExist.role,
      isUserExist.name,
      isUserExist.email,
    )
    //send token to client
    return authResponse(
      StatusCodes.OK,
      `Welcome back ${isUserExist.name}`,
      isUserExist.role,
      tokens.accessToken,
      tokens.refreshToken,
    )
  }
}

const resendOtpToPhoneOrEmail = async (
  authType: 'resetPassword' | 'createAccount',
  email?: string,
  phone?: string,
) => {
  const query = email ? { email: email } : { phone: phone }
  const isUserExist = await User.findOne({
    ...query,
    status: { $in: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE] },
  }).select('+authentication')
  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `No account found with this ${email ? 'email' : 'phone'}`,
    )
  }

  //check the request count
  const { authentication } = isUserExist
  if (authentication?.requestCount! >= 5) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You have exceeded the maximum number of requests. Please try again later.',
    )
  }
  const otp = generateOtp()
  const updatedAuthentication = {
    oneTimeCode: otp,
    latestRequestAt: new Date(),
    requestCount: authentication?.requestCount! + 1,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
  }

  //send otp to user
  if (email) {
    const forgetPasswordEmailTemplate = emailTemplate.resendOtp({
      email: isUserExist.email as string,
      name: isUserExist.name as string,
      otp,
      type: authType === 'resetPassword' && !isUserExist.password ? 'setPassword' : authType,
    })
    // emailQueue.add('emails', forgetPasswordEmailTemplate)

    await User.findByIdAndUpdate(
      isUserExist._id,
      {
        $set: { authentication: updatedAuthentication },
      },
      { new: true },
    )
  }
  // TODO : need mobile varificaition implementation after signup with phone
  if (phone) {
    // implement SMS OTP via SMS provider if needed

    await User.findByIdAndUpdate(
      isUserExist._id,
      {
        $set: { authentication: updatedAuthentication },
      },
      { new: true },
    )
  }
}

const deleteAccount = async (user: JwtPayload, password: string) => {
  const { authId } = user
  const isUserExist = await User.findById(authId).select('+password')
  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Failed to delete account. Please try again.',
    )
  }

  if (isUserExist.status === USER_STATUS.DELETED) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Requested user is already deleted.',
    )
  }

  const isPasswordMatched = await bcrypt.compare(password, isUserExist.password)

  if (!isPasswordMatched) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please provide a valid password to delete your account.',
    )
  }

  const deletedData = await User.findByIdAndUpdate(authId, {
    $set: { status: USER_STATUS.DELETED },
  })

  return {
    status: StatusCodes.OK,
    message: 'Account deleted successfully.',
    deletedData,
  }
}

const resendOtp = async (
  email: string,
  authType: 'createAccount' | 'resetPassword',
) => {
  const isUserExist = await User.findOne({
    email: email.toLowerCase().trim(),
    status: { $in: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE] },
  }).select('+password +authentication')
  if (!isUserExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `No account found with this ${email}, please try again.`,
    )
  }

  const { authentication } = isUserExist
  const nextRequestCount = (authentication?.requestCount || 0) + 1

  if (nextRequestCount > 5) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You have exceeded the maximum number of requests. Please try again later.',
    )
  }

  // Invited users (unverified, no password) keep the longer invite window
  const isInviteAccept =
    !isUserExist.verified && !isUserExist.password && authType === 'createAccount'
  const expiresAt = new Date(
    Date.now() + (isInviteAccept ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000),
  )

  const otp = generateOtp()
  const authenticationPayload = {
    oneTimeCode: otp,
    latestRequestAt: new Date(),
    requestCount: nextRequestCount,
    expiresAt,
    authType,
    resetPassword: authType === 'resetPassword',
  }

  await User.findByIdAndUpdate(
    isUserExist._id,
    {
      $set: { authentication: authenticationPayload },
    },
    { new: true },
  )

  if (email) {
    const forgetPasswordEmailTemplate = emailTemplate.resendOtp({
      email: email as string,
      name: (isUserExist.name as string) || 'there',
      otp,
      type: authType,
    })

    emailHelper.sendEmail(forgetPasswordEmailTemplate)
  }

  return 'OTP sent successfully.'
}

const changePassword = async (
  user: JwtPayload,
  currentPassword: string,
  newPassword: string,
) => {
  // Find the user with password field
  const isUserExist = await User.findById(user.authId)
    .select('+password')
    .lean()

  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  // Check if current password matches
  const isPasswordMatch = await AuthHelper.isPasswordMatched(
    currentPassword,
    isUserExist.password as string,
  )

  if (!isPasswordMatch) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Current password is incorrect')
  }

  // Hash the new password
  const hashedPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  )

  // Update the password
  await User.findByIdAndUpdate(
    user.authId,
    { password: hashedPassword },
    { new: true },
  )

  return { message: 'Password changed successfully' }
}

export const CustomAuthServices = {
  adminLogin,
  forgetPassword,
  resetPassword,
  verifyAccount,
  customLogin,
  getRefreshToken,
  socialLogin,
  resendOtpToPhoneOrEmail,
  deleteAccount,
  resendOtp,
  changePassword,
  createUser,
}
