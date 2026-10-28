import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { NotificationServices } from './notification.service'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import pick from '../../shared/pick'
import { INotificationFilterables } from './notification.interface'
import { notificationFilterableFields } from './notification.constant'
import { paginationFields } from '../../interfaces/pagination'
import { JwtPayload } from 'jsonwebtoken'
import { localizeDocument } from '../../helpers/localize'

const notificationFields = ['title', 'content', 'actionText']

const createNotification = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationServices.createNotification(req.body)

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Notification created successfully',
    data: localizeDocument(await NotificationServices.sanitizeNotificationResponse(result, req.user), req.lang, notificationFields),
  })
})

const getAllNotifications = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user
  const filters = pick(
    req.query,
    notificationFilterableFields,
  ) as INotificationFilterables
  const paginationOptions = pick(req.query, paginationFields)

  const result = await NotificationServices.getAllNotifications(
    user,
    filters,
    paginationOptions,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notifications retrieved successfully',
    meta: result.meta,
    data: localizeDocument(await NotificationServices.sanitizeNotificationResponse(result.data, req.user), req.lang, notificationFields),
  })
})

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user
  const filters = pick(
    req.query,
    notificationFilterableFields,
  ) as INotificationFilterables
  const paginationOptions = pick(req.query, paginationFields)

  const result = await NotificationServices.getMyNotifications(
    user,
    filters,
    paginationOptions,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'My notifications retrieved successfully',
    meta: result.meta,
    data: localizeDocument(await NotificationServices.sanitizeNotificationResponse(result.data, req.user), req.lang, notificationFields),
  })
})

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user
  const result = await NotificationServices.getUnreadCount(user.authId)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Unread notification count retrieved successfully',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const getNotificationById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await NotificationServices.getNotificationById(id)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notification retrieved successfully',
    data: localizeDocument(await NotificationServices.sanitizeNotificationResponse(result, req.user), req.lang, notificationFields),
  })
})

const updateNotification = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = (req as any).user

  const result = await NotificationServices.updateNotification(
    id,
    req.body,
    user.role === 'user' ? user.authId : undefined,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notification updated successfully',
    data: localizeDocument(await NotificationServices.sanitizeNotificationResponse(result, req.user), req.lang, notificationFields),
  })
})

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = (req as any).user

  const result = await NotificationServices.markAsRead(id, user.authId)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notification marked as read',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload

  const result = await NotificationServices.markAllAsRead(user.authId, req.body)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'All notifications marked as read',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const clearMyNotifications = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user

  const result = await NotificationServices.clearMyNotifications(
    user.authId,
    req.body,
  )

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notifications cleared successfully',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const archiveNotification = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = (req as any).user

  const result = await NotificationServices.archiveNotification(id, user.authId)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notification archived',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params

  const result = await NotificationServices.deleteNotification(id)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notification deleted successfully',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const getNotificationStats = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user

  const result = await NotificationServices.getNotificationStats(user)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notification statistics retrieved',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const sendTestEmail = catchAsync(async (req: Request, res: Response) => {
  const { to, template } = req.body

  const result = await NotificationServices.sendTestEmail(to, template)

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Test email sent successfully',
    data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
  })
})

const sendManualNotification = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationServices.sendManualNotification(req.body)

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Manual notifications sent successfully',
      data: await NotificationServices.sanitizeNotificationResponse(result, req.user),
    })
  },
)

export const NotificationController = {
  createNotification,
  getAllNotifications,
  getMyNotifications,
  getUnreadCount,
  clearMyNotifications,
  getNotificationById,
  updateNotification,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  deleteNotification,
  getNotificationStats,
  sendTestEmail,
  sendManualNotification,
}
