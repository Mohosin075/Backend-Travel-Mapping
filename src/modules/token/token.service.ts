import { Types } from 'mongoose'
import { Token } from './token.model'
const logout = async (userId: string) => {
  const res = await Token.updateOne(
    {
      user: new Types.ObjectId(userId),
    },
    {
      expireAt: new Date(Date.now()),
      token: '',
    },
  )


  return res
}
export const TokenServices = {
  logout,
}
