import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { StatsService } from './stats.service'

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
    String(id || '')
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Entity users fetched successfully',
    data: result,
  })
})

export const StatsController = {
  getDashboardData,
  getReportsData,
  searchReportEntities,
  getEntityUsers,
}
