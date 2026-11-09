export type IEmailOrPhoneOtpVerification = {
  oneTimeCode: string
  email?: string
  phone?: string
}

export type IVerificationResponse = {
  verified: boolean
  message: string
}

export type IForgetPassword = {
  email?: string
  phone?: string
}

export type IResetPassword = {
  email?: string
  phone?: string
  newPassword: string
  confirmPassword: string
}

export type IAuthResponse = {
  status: number
  message: string
  role?: string
  token?: string
  accessToken?: string
  refreshToken?: string
  needPassword?: boolean
  passwordSetupRequired?: boolean
}
