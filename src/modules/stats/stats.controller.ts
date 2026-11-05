import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { StatsService } from './stats.service'
import { recordAuthenticatedActivity } from './activity.service'
import { recordUniqueUsage } from './usage.service'
import { notifyStatsUpdated } from './stats-events'
import type { Socket, Server } from 'socket.io'

const notify = () => notifyStatsUpdated((global as typeof globalThis & { io?: Server }).io)

const recordActivity = catchAsync(async (req: Request, res: Response) => {
  if (await recordAuthenticatedActivity(req.headers.authorization)) notify()
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Activity recorded', data: null })
})

const recordUsage = catchAsync(async (req: Request, res: Response) => {
  // HTTP fallback works when a proxy blocks sockets. Never trust a body-supplied identity.
  const { type, id, visitorId } = req.body || {}
  await recordUniqueUsage({ handshake: { auth: {}, query: {}, headers: {} } } as Socket, {
    type, id, visitorId, token: req.headers.authorization || '',
  })
  notify()
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Usage recorded', data: null })
})

const getDashboardData = catchAsync(async (req: Request, res: Response) => {
  const result = await StatsService.getDashboardData()

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Dashboard data fetched successfully',
    data: result,
  })
})

const getReportsData = catchAsync(async (req: Request, res: Response) => {
  const result = await StatsService.getReportsData(req.query)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Reports data fetched successfully',
    data: result,
  })
})

const searchReportEntities = catchAsync(async (req: Request, res: Response) => {
  const result = await StatsService.searchReportEntities(
    String(req.query.searchTerm || ''),
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Report search suggestions fetched successfully',
    data: result,
  })
})


const getEntityUsers = catchAsync(async (req: Request, res: Response) => {
  const { type, id } = req.query
  const result = await StatsService.getEntityUsers(
    String(type || ''),
    String(id || ''),
    String(req.query.timeFilter || '')
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Entity users fetched successfully',
    data: result,
  })
})

export const StatsController = {
  recordActivity,
  recordUsage,
  getDashboardData,
  getReportsData,
  searchReportEntities,
  getEntityUsers,
}
