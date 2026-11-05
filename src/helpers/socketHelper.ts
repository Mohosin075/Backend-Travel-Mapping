import colors from 'colors'
import { Server } from 'socket.io'
import { recordUniqueUsage } from '../modules/stats/usage.service'
import { UsageView } from '../modules/stats/usageView.model'
import { UsageViewDay } from '../modules/stats/usageViewDay.model'
import { recordAuthenticatedActivity } from '../modules/stats/activity.service'
import { notifyStatsUpdated } from '../modules/stats/stats-events'

import { jwtHelper } from './jwtHelper'
import config from '../config'
import { Secret } from 'jsonwebtoken'

const socket = (io: Server) => {
  const notifyStats = () => notifyStatsUpdated(io)
  // createIndexes is additive; syncIndexes could drop production indexes.
  UsageView.createIndexes().catch(error => console.error('Failed to create usage indexes:', error))
  UsageViewDay.createIndexes().catch(error => console.error('Failed to create daily usage indexes:', error))

  io.on('connection', socket => {
    socket.on('track-activity', async (payload?: { token?: string }) => {
      try { if (await recordAuthenticatedActivity(payload?.token)) notifyStats() }
      catch (error) { console.error('Failed to record authenticated activity:', error) }
    })
    console.log(colors.blue('A user connected'), socket.id)

    // Auto-join user room if authentication token is provided in handshake
    const rawToken =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socket.handshake.headers?.authorization

    if (rawToken) {
      try {
        const token =
          typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
            ? rawToken.split(' ')[1]
            : rawToken
        const verifiedUser: any = jwtHelper.verifyToken(
          token,
          config.jwt.jwt_secret as Secret,
        )
        if (verifiedUser?.authId) {
          const authIdStr = verifiedUser.authId.toString()
          socket.join(authIdStr)
          socket.join(`room:${authIdStr}`)
          console.log(
            colors.green(
              `User socket ${socket.id} auto-joined room:${authIdStr}`,
            ),
          )
        }
      } catch {
        // Token invalid or expired, continue as guest
      }
    }

    socket.on('join-room', (roomId: string) => {
      if (roomId) {
        const idStr = roomId.toString()
        socket.join(idStr)
        socket.join(`room:${idStr}`)
        console.log(colors.green(`User ${socket.id} joined room:${idStr}`))
      }
    })

    socket.on('leave-room', (roomId: string) => {
      if (roomId) {
        socket.leave(`room:${roomId}`)
        console.log(colors.yellow(`User ${socket.id} left room:${roomId}`))
      }
    })

    socket.on(
      'track-usage',
      async (payload?: {
        type?: string
        id?: string
        visitorId?: string
        token?: string
      }) => {
        try {
          await recordUniqueUsage(socket, payload)
          notifyStats()
        } catch (error) {
          console.error('Failed to record usage via socket:', error)
        }
      },
    )

    socket.on('disconnect', () => {
      console.log(colors.red('A user disconnect'), socket.id)
    })
  })
}

export const socketHelper = { socket }
