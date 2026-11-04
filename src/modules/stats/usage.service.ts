import { Secret } from 'jsonwebtoken'
import { Socket } from 'socket.io'
import config from '../../config'
import { jwtHelper } from '../../helpers/jwtHelper'
import { BusinessService } from '../business/business.service'
import { MapService } from '../map/map.service'
import { PlaceService } from '../place/place.service'
import { UsageView } from './usageView.model'

const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000

const isObjectId = (id?: string) =>
  typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)

export type UsageType = 'map' | 'place' | 'business'

export const normalizeUsageType = (type?: string): UsageType | null => {
  const value = String(type || '').trim().toLowerCase()
  if (value === 'map') return 'map'
  if (value === 'business') return 'business'
  if (value === 'place' || value === 'regular') return 'place'
  return null
}

const readAuthId = (rawToken?: string): string | null => {
  if (!rawToken || typeof rawToken !== 'string') return null
  const token = rawToken.startsWith('Bearer ')
    ? rawToken.slice(7).trim()
    : rawToken.trim()
  if (!token) return null
  try {
    const user = jwtHelper.verifyToken(token, config.jwt.jwt_secret as Secret)
    const authId = user?.authId || user?._id || user?.id
    return authId ? String(authId) : null
  } catch {
    return null
  }
}

const handshakeToken = (socket: Socket): string | undefined => {
  const raw =
    socket.handshake.auth?.token ||
    socket.handshake.query?.token ||
    socket.handshake.headers?.authorization
  return typeof raw === 'string' ? raw : undefined
}

const viewerKeys = (
  socket: Socket,
  payload?: { visitorId?: string; token?: string },
): string[] => {
  // An explicit guest/expired token must not reuse another account's old handshake.
  const authId = payload?.token !== undefined
    ? readAuthId(payload.token)
    : readAuthId(handshakeToken(socket))
  if (authId) {
    // Authenticated users are tracked strictly by user ID so distinct accounts
    // on the same device/browser are tracked independently.
    return [`user:${authId}`]
  }

  const guestId = String(payload?.visitorId || '').trim()
  if (guestId && guestId.length >= 8 && guestId.length <= 80) {
    return [`guest:${guestId}`]
  }
  return []
}

const syncViewerKeys = async (
  keys: string[],
  type: UsageType,
  entityId: string,
  lastSeenAt: Date,
) => {
  if (keys.length < 2) return
  await UsageView.bulkWrite(
    keys.map(viewerKey => ({
      updateOne: {
        filter: { viewerKey, type, entityId },
        update: { $setOnInsert: { viewerKey, type, entityId, lastSeenAt } },
        upsert: true,
      },
    })),
    { ordered: false },
  )
}

const incrementCounter = async (type: UsageType, id: string) => {
  if (type === 'map') return MapService.incrementViewCount(id)
  if (type === 'place') return PlaceService.incrementOpenCount(id)
  return BusinessService.incrementViewCount(id)
}

export const recordUniqueUsage = async (
  socket: Socket,
  payload?: { type?: string; id?: string; visitorId?: string; token?: string },
) => {
  const type = normalizeUsageType(payload?.type)
  const entityId = String(payload?.id || '').trim()
  const keys = viewerKeys(socket, payload)
  if (!type || !isObjectId(entityId) || keys.length === 0) return

  const now = new Date()
  const cutoff = new Date(now.getTime() - VIEW_WINDOW_MS)
  const existing = await UsageView.find({
    viewerKey: { $in: keys },
    type,
    entityId,
  })
    .sort({ lastSeenAt: -1 })
    .lean()

  const latest = existing[0]
  if (latest && latest.lastSeenAt && latest.lastSeenAt >= cutoff) {
    await syncViewerKeys(keys, type, entityId, latest.lastSeenAt)
    return
  }

  try {
    if (latest) {
      const updated = await UsageView.findOneAndUpdate(
        { _id: latest._id, lastSeenAt: { $lte: cutoff } },
        { $set: { lastSeenAt: now } },
        { new: true },
      )
      if (!updated) return
    } else {
      await UsageView.create({
        viewerKey: keys[0],
        type,
        entityId,
        lastSeenAt: now,
      })
    }
  } catch (error: any) {
    if (error?.code === 11000) return
    throw error
  }

  try {
    await incrementCounter(type, entityId)
    await syncViewerKeys(keys, type, entityId, now)
  } catch (error) {
    await UsageView.deleteMany({
      viewerKey: { $in: keys },
      type,
      entityId,
      lastSeenAt: now,
    })
    throw error
  }
}
