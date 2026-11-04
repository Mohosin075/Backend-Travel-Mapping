import { Secret } from 'jsonwebtoken'
import config from '../../config'
import { jwtHelper } from '../../helpers/jwtHelper'
import { User } from '../user/user.model'

/** Keep activity separate from profile edits; write at most once per 25 seconds. */
export const recordAuthenticatedActivity = async (token?: string): Promise<boolean> => {
  if (!token) return false
  let user: any
  try { user = jwtHelper.verifyToken(token.replace(/^Bearer\s+/i, ''), config.jwt.jwt_secret as Secret) } catch { return false }
  if (!user?.authId || !/^[a-f\d]{24}$/i.test(String(user.authId))) return false
  const now = new Date()
  const result = await User.updateOne({
    _id: user.authId, status: { $ne: 'deleted' },
    $or: [{ lastActiveAt: { $exists: false } }, { lastActiveAt: { $lt: new Date(now.getTime() - 25000) } }],
  }, { $set: { lastActiveAt: now } }, { timestamps: false })
  return result.modifiedCount > 0
}
