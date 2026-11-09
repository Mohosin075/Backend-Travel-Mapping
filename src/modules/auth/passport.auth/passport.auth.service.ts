import { USER_ROLES, USER_STATUS } from '../../../enum/user'
import { ILoginData } from '../../../interfaces/auth'
import { StatusCodes } from 'http-status-codes'
import ApiError from '../../../errors/ApiError'
import { User } from '../../user/user.model'

import { IUser } from '../../user/user.interface'
import { AuthHelper } from '../auth.helper'
import { IAuthResponse } from '../auth.interface'
import { authResponse } from '../common'

const handleGoogleLogin = async (
  payload: IUser & { profile: any },
): Promise<IAuthResponse> => {
  const { emails, photos, displayName, id } = payload.profile
  const email = emails[0].value.toLowerCase().trim()
  const isUserExist = await User.findOne({
    email,
  })
  if (isUserExist) {
    if (isUserExist.status !== USER_STATUS.ACTIVE) throw new ApiError(StatusCodes.FORBIDDEN, 'This account is not active. Please contact support.')
    // Google proves ownership of this email. Retire any pre-existing guest
    // checkout capability before issuing this account's normal login tokens.
    if (!isUserExist.verified) {
      await User.findByIdAndUpdate(isUserExist._id, { $set: { verified: true,
        ...(isUserExist.provider === 'guest_purchase' ? { appId: id, provider: 'google' } : {}) } })
    }
    //return only the token
    const tokens = AuthHelper.createToken(
      isUserExist._id,
      isUserExist.role,
      isUserExist.name,
      isUserExist.email,
    )
    return authResponse(
      StatusCodes.OK,
      `Welcome ${isUserExist.name} to our platform.`,
      isUserExist.role,
      tokens.accessToken,
      tokens.refreshToken,
    )
  }

  const session = await User.startSession()
  session.startTransaction()

  const userData = {
    email,
    profile: photos?.[0]?.value || '',
    name: displayName,
    verified: true,
    // password: id,
    status: USER_STATUS.ACTIVE,
    appId: id,
    role: USER_ROLES.USER,
  }

  try {
    const user = await User.create([userData], { session })
    if (!user) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create user')
    }

    //create token
    const tokens = AuthHelper.createToken(
      user[0]._id,
      user[0].role,
      user[0].name,
      user[0].email,
    )

    await session.commitTransaction()
    session.endSession()

    return authResponse(
      StatusCodes.OK,
      `Welcome ${user[0].name} to our platform.`,
      user[0].role,
      tokens.accessToken,
      tokens.refreshToken,
    )
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    throw error
  }
}

export const PassportAuthServices = {
  handleGoogleLogin,
}
