import { StatusCodes } from 'http-status-codes'
import ApiError from '../../errors/ApiError'
import {
  INotification,
  INotificationFilterables,
  CreateNotificationDto,
  NotificationType,
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
  INotificationStats,
  IUnreadCountResponse,
  TARGET_AUDIENCE,
} from './notification.interface'
import { Notification } from './notification.model'
import { JwtPayload } from 'jsonwebtoken'
import { IPaginationOptions } from '../../interfaces/pagination'
import { paginationHelper } from '../../helpers/paginationHelper'
import { notificationSearchableFields } from './notification.constant'
import { Types } from 'mongoose'
import { emailProvider } from './notification.providers'
import { User } from '../user/user.model'
import config from '../../config'
import { autoTranslateField } from '../../utils/autoTranslate'

const getSocketIO = () => (global as any).io

const emitSocketToUser = (userId: string, event: string, payload: any) => {
  const io = getSocketIO()
  if (!io) return
  io.to(userId).emit(event, payload)
  io.to(`room:${userId}`).emit(event, payload)
}

const emitBroadcastSocket = (event: string, payload: any, room?: string) => {
  const io = getSocketIO()
  if (!io) return
  if (room) {
    io.to(room).emit(event, payload)
  } else {
    io.emit(event, payload)
  }
}

const processNotificationTranslations = async (payload: any) => {
  if (payload.title) payload.title = await autoTranslateField(payload.title)
  if (payload.content) payload.content = await autoTranslateField(payload.content)
  if (payload.actionText) payload.actionText = await autoTranslateField(payload.actionText)
}

const createNotification = async (
  payload: CreateNotificationDto,
  sendEmail: boolean = false,
): Promise<INotification> => {
  try {
    await processNotificationTranslations(payload)

    const roadtripeadoTypes = [
      NotificationType.NEW_OFFER,
      NotificationType.NEW_LOCATION,
      NotificationType.NEW_MAP,
      NotificationType.IMPORTANT_UPDATE,
      NotificationType.SYSTEM_ALERT,
    ]
    const category =
      payload.category ||
      (roadtripeadoTypes.includes(payload.type)
        ? NotificationCategory.ROADTRIPEADO
        : NotificationCategory.ACCOUNT)

    const notificationData: any = {
      userId: payload.userId,
      targetAudience: payload.targetAudience,
      category,
      interests: payload.interests || [],
      country: payload.country,
      title: payload.title,
      content: payload.content,
      type: payload.type,
      channel: payload.channel || NotificationChannel.IN_APP,
      priority: payload.priority || NotificationPriority.MEDIUM,
      metadata: payload.metadata || {},
      actionUrl: payload.actionUrl,
      actionText: payload.actionText,
      isRead: false,
      isArchived: false,
      status: payload.scheduledAt ? NotificationStatus.PENDING : NotificationStatus.SENT,
      readBy: [],
      archivedBy: [],
    }

    if (payload.scheduledAt) {
      notificationData.scheduledAt = payload.scheduledAt
    }

    const notification = await Notification.create(notificationData)

    // Send real-time notification via socket
    if (
      notification.channel !== NotificationChannel.EMAIL &&
      notification.userId
    ) {
      emitSocketToUser(notification.userId.toString(), 'notification', {
        type: 'NEW_NOTIFICATION',
        data: notification,
      })

      // Asynchronously update unread count on user socket
      getUnreadCount(notification.userId.toString())
        .then(unreadData => {
          emitSocketToUser(
            notification.userId!.toString(),
            'unread_count_update',
            unreadData,
          )
        })
        .catch(() => {})
    }

    // Send email if requested
    if (sendEmail && notification.channel !== NotificationChannel.IN_APP) {
      // Ensure notification.userId exists before sending email
      if (notification.userId) {
        await sendNotificationEmail(notification)
      } else {
        console.warn(
          'Cannot send email for notification without userId:',
          notification._id,
        )
      }
    }

    return notification
  } catch (error: any) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Failed to create notification: ${error.message}`,
    )
  }
}

const sendNotificationEmail = async (
  notification: INotification,
): Promise<void> => {
  try {
    const user = await User.findById(notification.userId)
    if (!user || !user.email) {
      throw new Error('User not found or no email available')
    }

    let template: string = 'system-alert'
    const titleStr =
      typeof notification.title === 'object' && notification.title !== null
        ? ((notification.title as any).es || (notification.title as any).en || '')
        : (notification.title || '')
    const contentStr =
      typeof notification.content === 'object' && notification.content !== null
        ? ((notification.content as any).es || (notification.content as any).en || '')
        : (notification.content || '')
    const actionTextStr =
      typeof notification.actionText === 'object' && notification.actionText !== null
        ? ((notification.actionText as any).es || (notification.actionText as any).en || '')
        : (notification.actionText || '')

    const templateData: Record<string, any> = {
      userName: user.name,
      notificationTitle: titleStr,
      notificationContent: contentStr,
      actionUrl: notification.actionUrl,
      actionText: actionTextStr,
    }

    // Map notification type to template and add specific data
    switch (notification.type) {
      case NotificationType.WELCOME:
        template = 'welcome'
        break

      case NotificationType.PASSWORD_RESET:
        template = 'password-reset'
        if (notification.metadata?.resetCode) {
          templateData.resetCode = notification.metadata.resetCode
          templateData.expiryMinutes = 30
        }
        break

      case NotificationType.ACCOUNT_VERIFICATION:
        template = 'account-verification'
        if (notification.metadata?.verificationToken) {
          templateData.verificationUrl = `${config.clientUrl}/verify-email?token=${notification.metadata.verificationToken}`
        }
        break

      default:
        template = 'system-alert'
    }

    await emailProvider.sendTemplateEmail(
      user.email,
      template,
      templateData,
      titleStr,
    )

    // Update notification status
    await Notification.findByIdAndUpdate(notification._id, {
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    })
  } catch (error: any) {
    console.error('Failed to send notification email:', error)

    // Update notification status to failed
    await Notification.findByIdAndUpdate(notification._id, {
      status: NotificationStatus.FAILED,
      metadata: {
        ...notification.metadata,
        emailError: error.message,
      },
    })

    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Failed to send email notification: ${error.message}`,
    )
  }
}

const getAllNotifications = async (
  user: JwtPayload,
  filterables: INotificationFilterables,
  pagination: IPaginationOptions,
) => {
  const { searchTerm, ...filterData } = filterables
  const { page, skip, limit, sortBy, sortOrder } =
    paginationHelper.calculatePagination(pagination)

  const andConditions: Record<string, any>[] = []

  // Search term
  if (searchTerm) {
    andConditions.push({
      $or: notificationSearchableFields.map(field => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      })),
    })
  }

  // Filter by other fields
  if (Object.keys(filterData).length) {
    const filterEntries = Object.entries(filterData)
    filterEntries.forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === 'startDate' || key === 'endDate') {
          // Date filtering - ensure value is string
          const dateCondition: any = {}
          if (key === 'startDate' && typeof value === 'string') {
            dateCondition.$gte = new Date(value)
          }
          if (key === 'endDate' && typeof value === 'string') {
            dateCondition.$lte = new Date(value)
          }
          if (Object.keys(dateCondition).length > 0) {
            andConditions.push({ createdAt: dateCondition })
          }
        } else if (key === 'isRead' || key === 'isArchived') {
          // Boolean filtering - convert string to boolean
          andConditions.push({ [key]: value === 'true' })
        } else {
          // Regular field filtering
          andConditions.push({ [key]: value })
        }
      }
    })
  }

  // User-specific filtering: user and map_editor see only their own + broadcast notifications
  // super_admin and admin see all notifications
  const restrictedRoles = ['user', 'map_editor']
  if (restrictedRoles.includes((user as any).role)) {
    andConditions.push({
      $or: [
        { userId: new Types.ObjectId((user as any).authId as string) },
        { targetAudience: TARGET_AUDIENCE.ALL_USER },
        { targetAudience: TARGET_AUDIENCE.ACTIVE_USER },
      ],
    })
  }

  const whereConditions = andConditions.length ? { $and: andConditions } : {}

  const [result, total] = await Promise.all([
    Notification.find(whereConditions)
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder })
      .populate('userId', 'name email')
      .lean(),
    Notification.countDocuments(whereConditions as any),
  ])

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: result,
  }
}

const getNotificationById = async (id: string): Promise<INotification> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid notification ID')
  }

  const result = await Notification.findById(id)
    .populate('userId', 'name email')
    .lean()

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found')
  }

  return result
}

const updateNotification = async (
  id: string,
  payload: Partial<INotification>,
  userId?: string,
): Promise<INotification> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid notification ID')
  }

  await processNotificationTranslations(payload)

  const query: any = { _id: id }
  if (userId) {
    query.userId = userId
  }

  const result = await Notification.findOneAndUpdate(
    query,
    { $set: payload },
    { new: true, runValidators: true },
  )
    .populate('userId', 'name email')
    .lean()

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found')
  }

  return result
}

const markAsRead = async (
  id: string,
  userId: string,
): Promise<INotification> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid notification ID')
  }

  const notif = await Notification.findById(id)
  if (!notif) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found')
  }

  const userObjectId = new Types.ObjectId(userId)

  let updated: INotification | null
  if (notif.userId && notif.userId.toString() === userId) {
    updated = await Notification.findByIdAndUpdate(
      id,
      {
        isRead: true,
        readAt: new Date(),
        status: NotificationStatus.READ,
      },
      { new: true },
    )
      .populate('userId', 'name email')
      .lean()
  } else {
    updated = await Notification.findByIdAndUpdate(
      id,
      {
        $addToSet: { readBy: userObjectId },
      },
      { new: true },
    )
      .populate('userId', 'name email')
      .lean()
  }

  // Real-time unread count update emit
  getUnreadCount(userId)
    .then(unreadData => {
      emitSocketToUser(userId, 'unread_count_update', unreadData)
    })
    .catch(() => {})

  return {
    ...updated!,
    isRead: true,
  }
}

const markAllAsRead = async (
  userId: string,
  options?: { category?: string; type?: NotificationType },
): Promise<{ modifiedCount: number }> => {
  const userObjectId = new Types.ObjectId(userId)
  const userDoc = await User.findById(userId).select('interest').lean()
  const userInterests = userDoc?.interest || []

  const personalQuery: any = {
    userId: userObjectId,
    isRead: false,
    isArchived: false,
  }

  const broadcastQuery: any = {
    userId: { $exists: false },
    readBy: { $ne: userObjectId },
    archivedBy: { $ne: userObjectId },
    $or: [
      {
        targetAudience: {
          $in: [TARGET_AUDIENCE.ALL_USER, TARGET_AUDIENCE.ACTIVE_USER],
        },
      },
      ...(userInterests.length > 0
        ? [{ interests: { $in: userInterests } }]
        : []),
    ],
  }

  if (options?.category && options.category !== 'all') {
    personalQuery.category = options.category
    broadcastQuery.category = options.category
  }
  if (options?.type) {
    personalQuery.type = options.type
    broadcastQuery.type = options.type
  }

  const [personalRes, broadcastRes] = await Promise.all([
    Notification.updateMany(personalQuery, {
      $set: {
        isRead: true,
        readAt: new Date(),
        status: NotificationStatus.READ,
      },
    }),
    Notification.updateMany(broadcastQuery, {
      $addToSet: { readBy: userObjectId },
    }),
  ])

  const modifiedCount =
    (personalRes.modifiedCount || 0) + (broadcastRes.modifiedCount || 0)

  // Real-time unread count update emit
  getUnreadCount(userId)
    .then(unreadData => {
      emitSocketToUser(userId, 'unread_count_update', unreadData)
    })
    .catch(() => {})

  return { modifiedCount }
}

const archiveNotification = async (
  id: string,
  userId: string,
): Promise<INotification> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid notification ID')
  }

  const notif = await Notification.findById(id)
  if (!notif) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found')
  }

  const userObjectId = new Types.ObjectId(userId)

  let updated: INotification | null
  if (notif.userId && notif.userId.toString() === userId) {
    updated = await Notification.findByIdAndUpdate(
      id,
      { isArchived: true, status: NotificationStatus.ARCHIVED },
      { new: true },
    )
      .populate('userId', 'name email')
      .lean()
  } else {
    updated = await Notification.findByIdAndUpdate(
      id,
      { $addToSet: { archivedBy: userObjectId } },
      { new: true },
    )
      .populate('userId', 'name email')
      .lean()
  }

  // Real-time unread count update emit
  getUnreadCount(userId)
    .then(unreadData => {
      emitSocketToUser(userId, 'unread_count_update', unreadData)
    })
    .catch(() => {})

  return {
    ...updated!,
    isArchived: true,
  }
}

const clearMyNotifications = async (
  userId: string,
  options?: { category?: string; type?: NotificationType; onlyRead?: boolean },
): Promise<{ clearedCount: number }> => {
  const userObjectId = new Types.ObjectId(userId)

  const personalQuery: any = {
    userId: userObjectId,
    isArchived: false,
  }
  const broadcastQuery: any = {
    userId: { $exists: false },
    archivedBy: { $ne: userObjectId },
  }

  if (options?.onlyRead) {
    personalQuery.isRead = true
    broadcastQuery.readBy = userObjectId
  }
  if (options?.category && options.category !== 'all') {
    personalQuery.category = options.category
    broadcastQuery.category = options.category
  }
  if (options?.type) {
    personalQuery.type = options.type
    broadcastQuery.type = options.type
  }

  const [personalRes, broadcastRes] = await Promise.all([
    Notification.updateMany(personalQuery, {
      $set: { isArchived: true, status: NotificationStatus.ARCHIVED },
    }),
    Notification.updateMany(broadcastQuery, {
      $addToSet: { archivedBy: userObjectId },
    }),
  ])

  const clearedCount =
    (personalRes.modifiedCount || 0) + (broadcastRes.modifiedCount || 0)

  // Real-time unread count update emit
  getUnreadCount(userId)
    .then(unreadData => {
      emitSocketToUser(userId, 'unread_count_update', unreadData)
    })
    .catch(() => {})

  return { clearedCount }
}

const getUnreadCount = async (userId: string): Promise<IUnreadCountResponse> => {
  const userObjectId = new Types.ObjectId(userId)
  const userDoc = await User.findById(userId).select('interest').lean()
  const userInterests = userDoc?.interest || []

  const unreadBaseQuery = {
    $or: [
      {
        userId: userObjectId,
        isRead: { $ne: true },
        isArchived: { $ne: true },
      },
      {
        userId: { $exists: false },
        readBy: { $ne: userObjectId },
        archivedBy: { $ne: userObjectId },
        $or: [
          {
            targetAudience: {
              $in: [TARGET_AUDIENCE.ALL_USER, TARGET_AUDIENCE.ACTIVE_USER],
            },
          },
          ...(userInterests.length > 0
            ? [{ interests: { $in: userInterests } }]
            : []),
        ],
      },
    ],
  }

  const [totalUnread, unreadAccount, unreadRoadtripeado, byTypeDocs] =
    await Promise.all([
      Notification.countDocuments(unreadBaseQuery),
      Notification.countDocuments({
        $and: [unreadBaseQuery, { category: NotificationCategory.ACCOUNT }],
      }),
      Notification.countDocuments({
        $and: [
          unreadBaseQuery,
          { category: NotificationCategory.ROADTRIPEADO },
        ],
      }),
      Notification.aggregate([
        { $match: unreadBaseQuery },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
    ])

  const byType: Record<string, number> = {}
  byTypeDocs.forEach(item => {
    byType[item._id] = item.count
  })

  return {
    totalUnread,
    unreadAccount,
    unreadRoadtripeado,
    byType,
  }
}

const deleteNotification = async (id: string): Promise<INotification> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid notification ID')
  }

  const result = await Notification.findByIdAndDelete(id).lean()

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found')
  }

  return result
}

const getNotificationStats = async (
  user: JwtPayload & { authId?: string; role?: string },
): Promise<INotificationStats> => {
  const restrictedRoles = ['user', 'map_editor']
  if (restrictedRoles.includes(user.role as string) && user.authId) {
    const unreadData = await getUnreadCount(user.authId)
    const userObjectId = new Types.ObjectId(user.authId)
    const userDoc = await User.findById(user.authId).select('interest').lean()
    const userInterests = userDoc?.interest || []

    const baseQuery = {
      $or: [
        { userId: userObjectId, isArchived: false },
        {
          userId: { $exists: false },
          archivedBy: { $ne: userObjectId },
          $or: [
            {
              targetAudience: {
                $in: [TARGET_AUDIENCE.ALL_USER, TARGET_AUDIENCE.ACTIVE_USER],
              },
            },
            ...(userInterests.length > 0
              ? [{ interests: { $in: userInterests } }]
              : []),
          ],
        },
      ],
    }

    const [total, byTypeDocs, byChannelDocs, byStatusDocs] =
      await Promise.all([
        Notification.countDocuments(baseQuery),
        Notification.aggregate([
          { $match: baseQuery },
          { $group: { _id: '$type', count: { $sum: 1 } } },
        ]),
        Notification.aggregate([
          { $match: baseQuery },
          { $group: { _id: '$channel', count: { $sum: 1 } } },
        ]),
        Notification.aggregate([
          { $match: baseQuery },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
      ])

    const stats: INotificationStats = {
      total,
      unread: unreadData.totalUnread,
      byType: {},
      byChannel: {},
      byStatus: {},
    }

    byTypeDocs.forEach(item => {
      stats.byType[item._id] = item.count
    })

    byChannelDocs.forEach(item => {
      stats.byChannel[item._id] = item.count
    })

    byStatusDocs.forEach(item => {
      stats.byStatus[item._id] = item.count
    })

    return stats
  }

  const query: any = {}

  const [total, unread, byType, byChannel, byStatus] = await Promise.all([
    Notification.countDocuments(query),
    Notification.countDocuments({ ...query, isRead: false }),
    Notification.aggregate([
      { $match: query },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    Notification.aggregate([
      { $match: query },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]),
    Notification.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ])

  const stats: INotificationStats = {
    total,
    unread,
    byType: {},
    byChannel: {},
    byStatus: {},
  }

  byType.forEach(item => {
    stats.byType[item._id] = item.count
  })

  byChannel.forEach(item => {
    stats.byChannel[item._id] = item.count
  })

  byStatus.forEach(item => {
    stats.byStatus[item._id] = item.count
  })

  return stats
}

const getMyNotifications = async (
  user: JwtPayload & { authId: string; role?: string },
  filterables: INotificationFilterables = {},
  pagination: IPaginationOptions,
) => {
  const { page, skip, limit, sortBy, sortOrder } =
    paginationHelper.calculatePagination(pagination)

  const userObjectId = new Types.ObjectId(user.authId)
  const userDoc = await User.findById(user.authId).select('interest').lean()
  const userInterests = userDoc?.interest || []

  const isReadFilter =
    filterables.isRead !== undefined && filterables.isRead !== ''
      ? filterables.isRead === true || filterables.isRead === 'true'
      : undefined

  const isArchivedFilter =
    filterables.isArchived !== undefined && filterables.isArchived !== ''
      ? filterables.isArchived === true || filterables.isArchived === 'true'
      : false

  // Base audience queries: personal vs audience/tailored
  const personalAudienceQuery: any = {
    userId: userObjectId,
    isArchived: isArchivedFilter,
  }
  if (isReadFilter !== undefined) {
    personalAudienceQuery.isRead = isReadFilter
  }

  const broadcastAudienceQuery: any = {
    userId: { $exists: false },
    archivedBy: isArchivedFilter ? userObjectId : { $ne: userObjectId },
    $or: [
      {
        targetAudience: {
          $in: [TARGET_AUDIENCE.ALL_USER, TARGET_AUDIENCE.ACTIVE_USER],
        },
      },
      ...(userInterests.length > 0
        ? [{ interests: { $in: userInterests } }]
        : []),
    ],
  }
  if (isReadFilter !== undefined) {
    if (isReadFilter) {
      broadcastAudienceQuery.readBy = userObjectId
    } else {
      broadcastAudienceQuery.readBy = { $ne: userObjectId }
    }
  }

  const andConditions: any[] = [
    {
      $or: [personalAudienceQuery, broadcastAudienceQuery],
    },
  ]

  // Category filter: 'account' | 'roadtripeado'
  if (filterables.category && filterables.category !== 'all') {
    andConditions.push({ category: filterables.category })
  }

  // Type filter
  if (filterables.type) {
    andConditions.push({ type: filterables.type })
  }

  // Priority filter
  if (filterables.priority) {
    andConditions.push({ priority: filterables.priority })
  }

  // Search term
  if (filterables.searchTerm && filterables.searchTerm.trim() !== '') {
    const term = filterables.searchTerm.trim()
    andConditions.push({
      $or: [
        { 'title.es': { $regex: term, $options: 'i' } },
        { 'title.en': { $regex: term, $options: 'i' } },
        { title: { $regex: term, $options: 'i' } },
        { 'content.es': { $regex: term, $options: 'i' } },
        { 'content.en': { $regex: term, $options: 'i' } },
        { content: { $regex: term, $options: 'i' } },
      ],
    })
  }

  const finalQuery = andConditions.length > 1 ? { $and: andConditions } : andConditions[0]

  const [result, total] = await Promise.all([
    Notification.find(finalQuery)
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder })
      .lean(),
    Notification.countDocuments(finalQuery),
  ])

  // Map individual read and archive state for frontend
  const formattedData = result.map(doc => {
    const isPersonal = Boolean(
      doc.userId && doc.userId.toString() === user.authId,
    )
    const isRead = isPersonal
      ? Boolean(doc.isRead)
      : Boolean(doc.readBy?.some(id => id.toString() === user.authId))
    const isArchived = isPersonal
      ? Boolean(doc.isArchived)
      : Boolean(doc.archivedBy?.some(id => id.toString() === user.authId))

    return {
      ...doc,
      isRead,
      isArchived,
    }
  })

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: formattedData,
  }
}

const sendTestEmail = async (
  to: string,
  template: string,
): Promise<boolean> => {
  try {
    const user = await User.findOne({ email: to })
    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
    }

    const testData = {
      userName: user.name,
      notificationTitle: 'Notificación de Prueba - Roadtripeado',
      notificationContent: 'Este es un correo de prueba de Roadtripeado.',
      resetCode: '123456',
      expiryMinutes: 30,
      verificationUrl: `${config.clientUrl}/verify-email?token=test-token-123`,
      actionUrl: `${config.clientUrl}/dashboard`,
      actionText: 'Ir al Panel de Control',
    }

    await emailProvider.sendTemplateEmail(to, template, testData)
    return true
  } catch (error: any) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Failed to send test email: ${error.message}`,
    )
  }
}

const sendManualNotification = async (
  payload: CreateNotificationDto,
): Promise<{ success: boolean }> => {
  try {
    await processNotificationTranslations(payload)

    const roadtripeadoTypes = [
      NotificationType.NEW_OFFER,
      NotificationType.NEW_LOCATION,
      NotificationType.NEW_MAP,
      NotificationType.IMPORTANT_UPDATE,
      NotificationType.SYSTEM_ALERT,
    ]
    const category =
      payload.category ||
      (roadtripeadoTypes.includes(payload.type)
        ? NotificationCategory.ROADTRIPEADO
        : NotificationCategory.ACCOUNT)

    const notificationData = {
      title: payload.title,
      content: payload.content,
      type: payload.type || NotificationType.SYSTEM_ALERT,
      category,
      interests: payload.interests || [],
      country: payload.country,
      channel: payload.channel || NotificationChannel.IN_APP,
      priority: payload.priority || NotificationPriority.MEDIUM,
      targetAudience: payload.targetAudience || TARGET_AUDIENCE.ACTIVE_USER,
      actionUrl: payload.actionUrl,
      actionText: payload.actionText,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      readBy: [],
      archivedBy: [],
    }

    const notification = await Notification.create(notificationData)

    // Emit broadcast socket event based on target audience
    if (payload.channel !== NotificationChannel.EMAIL) {
      const room =
        payload.targetAudience === TARGET_AUDIENCE.ACTIVE_USER
          ? 'active_users'
          : undefined
      emitBroadcastSocket(
        'notification',
        {
          type: 'BROADCAST_NOTIFICATION',
          data: notification,
        },
        room,
      )
    }

    return { success: true }
  } catch (error: any) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Failed to send manual notification: ${error.message}`,
    )
  }
}

const dispatchTailoredNotification = async (payload: {
  title: string | { en: string; es: string }
  content: string | { en: string; es: string }
  type: NotificationType
  category?: NotificationCategory
  interests?: string[]
  country?: string
  priority?: NotificationPriority
  actionUrl?: string
  actionText?: string | { en: string; es: string }
  metadata?: Record<string, any>
}): Promise<INotification> => {
  try {
    await processNotificationTranslations(payload)

    const roadtripeadoTypes = [
      NotificationType.NEW_OFFER,
      NotificationType.NEW_LOCATION,
      NotificationType.NEW_MAP,
      NotificationType.IMPORTANT_UPDATE,
      NotificationType.SYSTEM_ALERT,
    ]
    const category =
      payload.category ||
      (roadtripeadoTypes.includes(payload.type)
        ? NotificationCategory.ROADTRIPEADO
        : NotificationCategory.ACCOUNT)

    const notification = await Notification.create({
      title: payload.title,
      content: payload.content,
      type: payload.type,
      category,
      interests: payload.interests || [],
      country: payload.country,
      priority: payload.priority || NotificationPriority.MEDIUM,
      channel: NotificationChannel.IN_APP,
      targetAudience: TARGET_AUDIENCE.ALL_USER,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      actionUrl: payload.actionUrl,
      actionText: payload.actionText,
      metadata: payload.metadata || {},
      readBy: [],
      archivedBy: [],
    })

    emitBroadcastSocket('notification', {
      type: 'BROADCAST_NOTIFICATION',
      data: notification,
    })

    return notification
  } catch (error: any) {
    console.error('Failed to dispatch tailored notification:', error)
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Failed to dispatch tailored notification: ${error.message}`,
    )
  }
}

export const NotificationServices = {
  createNotification,
  sendNotificationEmail,
  getAllNotifications,
  getNotificationById,
  updateNotification,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  clearMyNotifications,
  getUnreadCount,
  deleteNotification,
  getNotificationStats,
  getMyNotifications,
  sendTestEmail,
  sendManualNotification,
  dispatchTailoredNotification,
}
