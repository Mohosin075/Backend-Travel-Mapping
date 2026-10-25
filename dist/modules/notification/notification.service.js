"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationServices = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const notification_interface_1 = require("./notification.interface");
const notification_model_1 = require("./notification.model");
const paginationHelper_1 = require("../../helpers/paginationHelper");
const notification_constant_1 = require("./notification.constant");
const mongoose_1 = require("mongoose");
const notification_providers_1 = require("./notification.providers");
const user_model_1 = require("../user/user.model");
const config_1 = __importDefault(require("../../config"));
const autoTranslate_1 = require("../../utils/autoTranslate");
const getSocketIO = () => global.io;
const emitSocketToUser = (userId, event, payload) => {
    const io = getSocketIO();
    if (!io)
        return;
    io.to(userId).emit(event, payload);
    io.to(`room:${userId}`).emit(event, payload);
};
const emitBroadcastSocket = (event, payload, room) => {
    const io = getSocketIO();
    if (!io)
        return;
    if (room) {
        io.to(room).emit(event, payload);
    }
    else {
        io.emit(event, payload);
    }
};
const processNotificationTranslations = async (payload) => {
    if (payload.title)
        payload.title = await (0, autoTranslate_1.autoTranslateField)(payload.title);
    if (payload.content)
        payload.content = await (0, autoTranslate_1.autoTranslateField)(payload.content);
    if (payload.actionText)
        payload.actionText = await (0, autoTranslate_1.autoTranslateField)(payload.actionText);
};
const createNotification = async (payload, sendEmail = false) => {
    try {
        await processNotificationTranslations(payload);
        const roadtripeadoTypes = [
            notification_interface_1.NotificationType.NEW_OFFER,
            notification_interface_1.NotificationType.NEW_LOCATION,
            notification_interface_1.NotificationType.NEW_MAP,
            notification_interface_1.NotificationType.IMPORTANT_UPDATE,
            notification_interface_1.NotificationType.SYSTEM_ALERT,
        ];
        const category = payload.category ||
            (roadtripeadoTypes.includes(payload.type)
                ? notification_interface_1.NotificationCategory.ROADTRIPEADO
                : notification_interface_1.NotificationCategory.ACCOUNT);
        const notificationData = {
            userId: payload.userId,
            targetAudience: payload.targetAudience,
            category,
            interests: payload.interests || [],
            country: payload.country,
            title: payload.title,
            content: payload.content,
            type: payload.type,
            channel: payload.channel || notification_interface_1.NotificationChannel.IN_APP,
            priority: payload.priority || notification_interface_1.NotificationPriority.MEDIUM,
            metadata: payload.metadata || {},
            actionUrl: payload.actionUrl,
            actionText: payload.actionText,
            isRead: false,
            isArchived: false,
            status: payload.scheduledAt ? notification_interface_1.NotificationStatus.PENDING : notification_interface_1.NotificationStatus.SENT,
            readBy: [],
            archivedBy: [],
        };
        if (payload.scheduledAt) {
            notificationData.scheduledAt = payload.scheduledAt;
        }
        const notification = await notification_model_1.Notification.create(notificationData);
        // Send real-time notification via socket
        if (notification.channel !== notification_interface_1.NotificationChannel.EMAIL &&
            notification.userId) {
            emitSocketToUser(notification.userId.toString(), 'notification', {
                type: 'NEW_NOTIFICATION',
                data: notification,
            });
            // Asynchronously update unread count on user socket
            getUnreadCount(notification.userId.toString())
                .then(unreadData => {
                emitSocketToUser(notification.userId.toString(), 'unread_count_update', unreadData);
            })
                .catch(() => { });
        }
        // Send email if requested
        if (sendEmail && notification.channel !== notification_interface_1.NotificationChannel.IN_APP) {
            // Ensure notification.userId exists before sending email
            if (notification.userId) {
                await sendNotificationEmail(notification);
            }
            else {
                console.warn('Cannot send email for notification without userId:', notification._id);
            }
        }
        return notification;
    }
    catch (error) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Failed to create notification: ${error.message}`);
    }
};
const sendNotificationEmail = async (notification) => {
    var _a, _b;
    try {
        const user = await user_model_1.User.findById(notification.userId);
        if (!user || !user.email) {
            throw new Error('User not found or no email available');
        }
        let template = 'system-alert';
        const titleStr = typeof notification.title === 'object' && notification.title !== null
            ? (notification.title.es || notification.title.en || '')
            : (notification.title || '');
        const contentStr = typeof notification.content === 'object' && notification.content !== null
            ? (notification.content.es || notification.content.en || '')
            : (notification.content || '');
        const actionTextStr = typeof notification.actionText === 'object' && notification.actionText !== null
            ? (notification.actionText.es || notification.actionText.en || '')
            : (notification.actionText || '');
        const templateData = {
            userName: user.name,
            notificationTitle: titleStr,
            notificationContent: contentStr,
            actionUrl: notification.actionUrl,
            actionText: actionTextStr,
        };
        // Map notification type to template and add specific data
        switch (notification.type) {
            case notification_interface_1.NotificationType.WELCOME:
                template = 'welcome';
                break;
            case notification_interface_1.NotificationType.PASSWORD_RESET:
                template = 'password-reset';
                if ((_a = notification.metadata) === null || _a === void 0 ? void 0 : _a.resetCode) {
                    templateData.resetCode = notification.metadata.resetCode;
                    templateData.expiryMinutes = 30;
                }
                break;
            case notification_interface_1.NotificationType.ACCOUNT_VERIFICATION:
                template = 'account-verification';
                if ((_b = notification.metadata) === null || _b === void 0 ? void 0 : _b.verificationToken) {
                    templateData.verificationUrl = `${config_1.default.clientUrl}/verify-email?token=${notification.metadata.verificationToken}`;
                }
                break;
            default:
                template = 'system-alert';
        }
        await notification_providers_1.emailProvider.sendTemplateEmail(user.email, template, templateData, titleStr);
        // Update notification status
        await notification_model_1.Notification.findByIdAndUpdate(notification._id, {
            status: notification_interface_1.NotificationStatus.SENT,
            sentAt: new Date(),
        });
    }
    catch (error) {
        console.error('Failed to send notification email:', error);
        // Update notification status to failed
        await notification_model_1.Notification.findByIdAndUpdate(notification._id, {
            status: notification_interface_1.NotificationStatus.FAILED,
            metadata: {
                ...notification.metadata,
                emailError: error.message,
            },
        });
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Failed to send email notification: ${error.message}`);
    }
};
const getAllNotifications = async (user, filterables, pagination) => {
    const { searchTerm, ...filterData } = filterables;
    const { page, skip, limit, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(pagination);
    const andConditions = [];
    // Search term
    if (searchTerm) {
        andConditions.push({
            $or: notification_constant_1.notificationSearchableFields.map(field => ({
                [field]: {
                    $regex: searchTerm,
                    $options: 'i',
                },
            })),
        });
    }
    // Filter by other fields
    if (Object.keys(filterData).length) {
        const filterEntries = Object.entries(filterData);
        filterEntries.forEach(([key, value]) => {
            if (value !== undefined) {
                if (key === 'startDate' || key === 'endDate') {
                    // Date filtering - ensure value is string
                    const dateCondition = {};
                    if (key === 'startDate' && typeof value === 'string') {
                        dateCondition.$gte = new Date(value);
                    }
                    if (key === 'endDate' && typeof value === 'string') {
                        dateCondition.$lte = new Date(value);
                    }
                    if (Object.keys(dateCondition).length > 0) {
                        andConditions.push({ createdAt: dateCondition });
                    }
                }
                else if (key === 'isRead' || key === 'isArchived') {
                    // Boolean filtering - convert string to boolean
                    andConditions.push({ [key]: value === 'true' });
                }
                else {
                    // Regular field filtering
                    andConditions.push({ [key]: value });
                }
            }
        });
    }
    // User-specific filtering: user and map_editor see only their own + broadcast notifications
    // super_admin and admin see all notifications
    const restrictedRoles = ['user', 'map_editor'];
    if (restrictedRoles.includes(user.role)) {
        andConditions.push({
            $or: [
                { userId: new mongoose_1.Types.ObjectId(user.authId) },
                { targetAudience: notification_interface_1.TARGET_AUDIENCE.ALL_USER },
                { targetAudience: notification_interface_1.TARGET_AUDIENCE.ACTIVE_USER },
            ],
        });
    }
    const whereConditions = andConditions.length ? { $and: andConditions } : {};
    const [result, total] = await Promise.all([
        notification_model_1.Notification.find(whereConditions)
            .skip(skip)
            .limit(limit)
            .sort({ [sortBy]: sortOrder })
            .populate('userId', 'name email')
            .lean(),
        notification_model_1.Notification.countDocuments(whereConditions),
    ]);
    return {
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
        data: result,
    };
};
const getNotificationById = async (id) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid notification ID');
    }
    const result = await notification_model_1.Notification.findById(id)
        .populate('userId', 'name email')
        .lean();
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Notification not found');
    }
    return result;
};
const updateNotification = async (id, payload, userId) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid notification ID');
    }
    await processNotificationTranslations(payload);
    const query = { _id: id };
    if (userId) {
        query.userId = userId;
    }
    const result = await notification_model_1.Notification.findOneAndUpdate(query, { $set: payload }, { new: true, runValidators: true })
        .populate('userId', 'name email')
        .lean();
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Notification not found');
    }
    return result;
};
const markAsRead = async (id, userId) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid notification ID');
    }
    const notif = await notification_model_1.Notification.findById(id);
    if (!notif) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Notification not found');
    }
    const userObjectId = new mongoose_1.Types.ObjectId(userId);
    let updated;
    if (notif.userId && notif.userId.toString() === userId) {
        updated = await notification_model_1.Notification.findByIdAndUpdate(id, {
            isRead: true,
            readAt: new Date(),
            status: notification_interface_1.NotificationStatus.READ,
        }, { new: true })
            .populate('userId', 'name email')
            .lean();
    }
    else {
        updated = await notification_model_1.Notification.findByIdAndUpdate(id, {
            $addToSet: { readBy: userObjectId },
        }, { new: true })
            .populate('userId', 'name email')
            .lean();
    }
    // Real-time unread count update emit
    getUnreadCount(userId)
        .then(unreadData => {
        emitSocketToUser(userId, 'unread_count_update', unreadData);
    })
        .catch(() => { });
    return {
        ...updated,
        isRead: true,
    };
};
const markAllAsRead = async (userId, options) => {
    const userObjectId = new mongoose_1.Types.ObjectId(userId);
    const userDoc = await user_model_1.User.findById(userId).select('interest').lean();
    const userInterests = (userDoc === null || userDoc === void 0 ? void 0 : userDoc.interest) || [];
    const personalQuery = {
        userId: userObjectId,
        isRead: false,
        isArchived: false,
    };
    const broadcastQuery = {
        userId: { $exists: false },
        readBy: { $ne: userObjectId },
        archivedBy: { $ne: userObjectId },
        $or: [
            {
                targetAudience: {
                    $in: [notification_interface_1.TARGET_AUDIENCE.ALL_USER, notification_interface_1.TARGET_AUDIENCE.ACTIVE_USER],
                },
            },
            ...(userInterests.length > 0
                ? [{ interests: { $in: userInterests } }]
                : []),
        ],
    };
    if ((options === null || options === void 0 ? void 0 : options.category) && options.category !== 'all') {
        personalQuery.category = options.category;
        broadcastQuery.category = options.category;
    }
    if (options === null || options === void 0 ? void 0 : options.type) {
        personalQuery.type = options.type;
        broadcastQuery.type = options.type;
    }
    const [personalRes, broadcastRes] = await Promise.all([
        notification_model_1.Notification.updateMany(personalQuery, {
            $set: {
                isRead: true,
                readAt: new Date(),
                status: notification_interface_1.NotificationStatus.READ,
            },
        }),
        notification_model_1.Notification.updateMany(broadcastQuery, {
            $addToSet: { readBy: userObjectId },
        }),
    ]);
    const modifiedCount = (personalRes.modifiedCount || 0) + (broadcastRes.modifiedCount || 0);
    // Real-time unread count update emit
    getUnreadCount(userId)
        .then(unreadData => {
        emitSocketToUser(userId, 'unread_count_update', unreadData);
    })
        .catch(() => { });
    return { modifiedCount };
};
const archiveNotification = async (id, userId) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid notification ID');
    }
    const notif = await notification_model_1.Notification.findById(id);
    if (!notif) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Notification not found');
    }
    const userObjectId = new mongoose_1.Types.ObjectId(userId);
    let updated;
    if (notif.userId && notif.userId.toString() === userId) {
        updated = await notification_model_1.Notification.findByIdAndUpdate(id, { isArchived: true, status: notification_interface_1.NotificationStatus.ARCHIVED }, { new: true })
            .populate('userId', 'name email')
            .lean();
    }
    else {
        updated = await notification_model_1.Notification.findByIdAndUpdate(id, { $addToSet: { archivedBy: userObjectId } }, { new: true })
            .populate('userId', 'name email')
            .lean();
    }
    // Real-time unread count update emit
    getUnreadCount(userId)
        .then(unreadData => {
        emitSocketToUser(userId, 'unread_count_update', unreadData);
    })
        .catch(() => { });
    return {
        ...updated,
        isArchived: true,
    };
};
const clearMyNotifications = async (userId, options) => {
    const userObjectId = new mongoose_1.Types.ObjectId(userId);
    const personalQuery = {
        userId: userObjectId,
        isArchived: false,
    };
    const broadcastQuery = {
        userId: { $exists: false },
        archivedBy: { $ne: userObjectId },
    };
    if (options === null || options === void 0 ? void 0 : options.onlyRead) {
        personalQuery.isRead = true;
        broadcastQuery.readBy = userObjectId;
    }
    if ((options === null || options === void 0 ? void 0 : options.category) && options.category !== 'all') {
        personalQuery.category = options.category;
        broadcastQuery.category = options.category;
    }
    if (options === null || options === void 0 ? void 0 : options.type) {
        personalQuery.type = options.type;
        broadcastQuery.type = options.type;
    }
    const [personalRes, broadcastRes] = await Promise.all([
        notification_model_1.Notification.updateMany(personalQuery, {
            $set: { isArchived: true, status: notification_interface_1.NotificationStatus.ARCHIVED },
        }),
        notification_model_1.Notification.updateMany(broadcastQuery, {
            $addToSet: { archivedBy: userObjectId },
        }),
    ]);
    const clearedCount = (personalRes.modifiedCount || 0) + (broadcastRes.modifiedCount || 0);
    // Real-time unread count update emit
    getUnreadCount(userId)
        .then(unreadData => {
        emitSocketToUser(userId, 'unread_count_update', unreadData);
    })
        .catch(() => { });
    return { clearedCount };
};
const getUnreadCount = async (userId) => {
    const userObjectId = new mongoose_1.Types.ObjectId(userId);
    const userDoc = await user_model_1.User.findById(userId).select('interest').lean();
    const userInterests = (userDoc === null || userDoc === void 0 ? void 0 : userDoc.interest) || [];
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
                            $in: [notification_interface_1.TARGET_AUDIENCE.ALL_USER, notification_interface_1.TARGET_AUDIENCE.ACTIVE_USER],
                        },
                    },
                    ...(userInterests.length > 0
                        ? [{ interests: { $in: userInterests } }]
                        : []),
                ],
            },
        ],
    };
    const [totalUnread, unreadAccount, unreadRoadtripeado, byTypeDocs] = await Promise.all([
        notification_model_1.Notification.countDocuments(unreadBaseQuery),
        notification_model_1.Notification.countDocuments({
            $and: [unreadBaseQuery, { category: notification_interface_1.NotificationCategory.ACCOUNT }],
        }),
        notification_model_1.Notification.countDocuments({
            $and: [
                unreadBaseQuery,
                { category: notification_interface_1.NotificationCategory.ROADTRIPEADO },
            ],
        }),
        notification_model_1.Notification.aggregate([
            { $match: unreadBaseQuery },
            { $group: { _id: '$type', count: { $sum: 1 } } },
        ]),
    ]);
    const byType = {};
    byTypeDocs.forEach(item => {
        byType[item._id] = item.count;
    });
    return {
        totalUnread,
        unreadAccount,
        unreadRoadtripeado,
        byType,
    };
};
const deleteNotification = async (id) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid notification ID');
    }
    const result = await notification_model_1.Notification.findByIdAndDelete(id).lean();
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Notification not found');
    }
    return result;
};
const getNotificationStats = async (user) => {
    const restrictedRoles = ['user', 'map_editor'];
    if (restrictedRoles.includes(user.role) && user.authId) {
        const unreadData = await getUnreadCount(user.authId);
        const userObjectId = new mongoose_1.Types.ObjectId(user.authId);
        const userDoc = await user_model_1.User.findById(user.authId).select('interest').lean();
        const userInterests = (userDoc === null || userDoc === void 0 ? void 0 : userDoc.interest) || [];
        const baseQuery = {
            $or: [
                { userId: userObjectId, isArchived: false },
                {
                    userId: { $exists: false },
                    archivedBy: { $ne: userObjectId },
                    $or: [
                        {
                            targetAudience: {
                                $in: [notification_interface_1.TARGET_AUDIENCE.ALL_USER, notification_interface_1.TARGET_AUDIENCE.ACTIVE_USER],
                            },
                        },
                        ...(userInterests.length > 0
                            ? [{ interests: { $in: userInterests } }]
                            : []),
                    ],
                },
            ],
        };
        const [total, byTypeDocs, byChannelDocs, byStatusDocs] = await Promise.all([
            notification_model_1.Notification.countDocuments(baseQuery),
            notification_model_1.Notification.aggregate([
                { $match: baseQuery },
                { $group: { _id: '$type', count: { $sum: 1 } } },
            ]),
            notification_model_1.Notification.aggregate([
                { $match: baseQuery },
                { $group: { _id: '$channel', count: { $sum: 1 } } },
            ]),
            notification_model_1.Notification.aggregate([
                { $match: baseQuery },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
        ]);
        const stats = {
            total,
            unread: unreadData.totalUnread,
            byType: {},
            byChannel: {},
            byStatus: {},
        };
        byTypeDocs.forEach(item => {
            stats.byType[item._id] = item.count;
        });
        byChannelDocs.forEach(item => {
            stats.byChannel[item._id] = item.count;
        });
        byStatusDocs.forEach(item => {
            stats.byStatus[item._id] = item.count;
        });
        return stats;
    }
    const query = {};
    const [total, unread, byType, byChannel, byStatus] = await Promise.all([
        notification_model_1.Notification.countDocuments(query),
        notification_model_1.Notification.countDocuments({ ...query, isRead: false }),
        notification_model_1.Notification.aggregate([
            { $match: query },
            { $group: { _id: '$type', count: { $sum: 1 } } },
        ]),
        notification_model_1.Notification.aggregate([
            { $match: query },
            { $group: { _id: '$channel', count: { $sum: 1 } } },
        ]),
        notification_model_1.Notification.aggregate([
            { $match: query },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
    ]);
    const stats = {
        total,
        unread,
        byType: {},
        byChannel: {},
        byStatus: {},
    };
    byType.forEach(item => {
        stats.byType[item._id] = item.count;
    });
    byChannel.forEach(item => {
        stats.byChannel[item._id] = item.count;
    });
    byStatus.forEach(item => {
        stats.byStatus[item._id] = item.count;
    });
    return stats;
};
const getMyNotifications = async (user, filterables = {}, pagination) => {
    const { page, skip, limit, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(pagination);
    const userObjectId = new mongoose_1.Types.ObjectId(user.authId);
    const userDoc = await user_model_1.User.findById(user.authId).select('interest').lean();
    const userInterests = (userDoc === null || userDoc === void 0 ? void 0 : userDoc.interest) || [];
    const isReadFilter = filterables.isRead !== undefined && filterables.isRead !== ''
        ? filterables.isRead === true || filterables.isRead === 'true'
        : undefined;
    const isArchivedFilter = filterables.isArchived !== undefined && filterables.isArchived !== ''
        ? filterables.isArchived === true || filterables.isArchived === 'true'
        : false;
    // Base audience queries: personal vs audience/tailored
    const personalAudienceQuery = {
        userId: userObjectId,
        isArchived: isArchivedFilter,
    };
    if (isReadFilter !== undefined) {
        personalAudienceQuery.isRead = isReadFilter;
    }
    const broadcastAudienceQuery = {
        userId: { $exists: false },
        archivedBy: isArchivedFilter ? userObjectId : { $ne: userObjectId },
        $or: [
            {
                targetAudience: {
                    $in: [notification_interface_1.TARGET_AUDIENCE.ALL_USER, notification_interface_1.TARGET_AUDIENCE.ACTIVE_USER],
                },
            },
            ...(userInterests.length > 0
                ? [{ interests: { $in: userInterests } }]
                : []),
        ],
    };
    if (isReadFilter !== undefined) {
        if (isReadFilter) {
            broadcastAudienceQuery.readBy = userObjectId;
        }
        else {
            broadcastAudienceQuery.readBy = { $ne: userObjectId };
        }
    }
    const andConditions = [
        {
            $or: [personalAudienceQuery, broadcastAudienceQuery],
        },
    ];
    // Category filter: 'account' | 'roadtripeado'
    if (filterables.category && filterables.category !== 'all') {
        andConditions.push({ category: filterables.category });
    }
    // Type filter
    if (filterables.type) {
        andConditions.push({ type: filterables.type });
    }
    // Priority filter
    if (filterables.priority) {
        andConditions.push({ priority: filterables.priority });
    }
    // Search term
    if (filterables.searchTerm && filterables.searchTerm.trim() !== '') {
        const term = filterables.searchTerm.trim();
        andConditions.push({
            $or: [
                { 'title.es': { $regex: term, $options: 'i' } },
                { 'title.en': { $regex: term, $options: 'i' } },
                { title: { $regex: term, $options: 'i' } },
                { 'content.es': { $regex: term, $options: 'i' } },
                { 'content.en': { $regex: term, $options: 'i' } },
                { content: { $regex: term, $options: 'i' } },
            ],
        });
    }
    const finalQuery = andConditions.length > 1 ? { $and: andConditions } : andConditions[0];
    const [result, total] = await Promise.all([
        notification_model_1.Notification.find(finalQuery)
            .skip(skip)
            .limit(limit)
            .sort({ [sortBy]: sortOrder })
            .lean(),
        notification_model_1.Notification.countDocuments(finalQuery),
    ]);
    // Map individual read and archive state for frontend
    const formattedData = result.map(doc => {
        var _a, _b;
        const isPersonal = Boolean(doc.userId && doc.userId.toString() === user.authId);
        const isRead = isPersonal
            ? Boolean(doc.isRead)
            : Boolean((_a = doc.readBy) === null || _a === void 0 ? void 0 : _a.some(id => id.toString() === user.authId));
        const isArchived = isPersonal
            ? Boolean(doc.isArchived)
            : Boolean((_b = doc.archivedBy) === null || _b === void 0 ? void 0 : _b.some(id => id.toString() === user.authId));
        return {
            ...doc,
            isRead,
            isArchived,
        };
    });
    return {
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
        data: formattedData,
    };
};
const sendTestEmail = async (to, template) => {
    try {
        const user = await user_model_1.User.findOne({ email: to });
        if (!user) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
        }
        const testData = {
            userName: user.name,
            notificationTitle: 'Notificación de Prueba - Roadtripeado',
            notificationContent: 'Este es un correo de prueba de Roadtripeado.',
            resetCode: '123456',
            expiryMinutes: 30,
            verificationUrl: `${config_1.default.clientUrl}/verify-email?token=test-token-123`,
            actionUrl: `${config_1.default.clientUrl}/dashboard`,
            actionText: 'Ir al Panel de Control',
        };
        await notification_providers_1.emailProvider.sendTemplateEmail(to, template, testData);
        return true;
    }
    catch (error) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Failed to send test email: ${error.message}`);
    }
};
const sendManualNotification = async (payload) => {
    try {
        await processNotificationTranslations(payload);
        const roadtripeadoTypes = [
            notification_interface_1.NotificationType.NEW_OFFER,
            notification_interface_1.NotificationType.NEW_LOCATION,
            notification_interface_1.NotificationType.NEW_MAP,
            notification_interface_1.NotificationType.IMPORTANT_UPDATE,
            notification_interface_1.NotificationType.SYSTEM_ALERT,
        ];
        const category = payload.category ||
            (roadtripeadoTypes.includes(payload.type)
                ? notification_interface_1.NotificationCategory.ROADTRIPEADO
                : notification_interface_1.NotificationCategory.ACCOUNT);
        const notificationData = {
            title: payload.title,
            content: payload.content,
            type: payload.type || notification_interface_1.NotificationType.SYSTEM_ALERT,
            category,
            interests: payload.interests || [],
            country: payload.country,
            channel: payload.channel || notification_interface_1.NotificationChannel.IN_APP,
            priority: payload.priority || notification_interface_1.NotificationPriority.MEDIUM,
            targetAudience: payload.targetAudience || notification_interface_1.TARGET_AUDIENCE.ACTIVE_USER,
            actionUrl: payload.actionUrl,
            actionText: payload.actionText,
            status: notification_interface_1.NotificationStatus.SENT,
            sentAt: new Date(),
            readBy: [],
            archivedBy: [],
        };
        const notification = await notification_model_1.Notification.create(notificationData);
        // Emit broadcast socket event based on target audience
        if (payload.channel !== notification_interface_1.NotificationChannel.EMAIL) {
            const room = payload.targetAudience === notification_interface_1.TARGET_AUDIENCE.ACTIVE_USER
                ? 'active_users'
                : undefined;
            emitBroadcastSocket('notification', {
                type: 'BROADCAST_NOTIFICATION',
                data: notification,
            }, room);
        }
        return { success: true };
    }
    catch (error) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Failed to send manual notification: ${error.message}`);
    }
};
const dispatchTailoredNotification = async (payload) => {
    try {
        await processNotificationTranslations(payload);
        const roadtripeadoTypes = [
            notification_interface_1.NotificationType.NEW_OFFER,
            notification_interface_1.NotificationType.NEW_LOCATION,
            notification_interface_1.NotificationType.NEW_MAP,
            notification_interface_1.NotificationType.IMPORTANT_UPDATE,
            notification_interface_1.NotificationType.SYSTEM_ALERT,
        ];
        const category = payload.category ||
            (roadtripeadoTypes.includes(payload.type)
                ? notification_interface_1.NotificationCategory.ROADTRIPEADO
                : notification_interface_1.NotificationCategory.ACCOUNT);
        const notification = await notification_model_1.Notification.create({
            title: payload.title,
            content: payload.content,
            type: payload.type,
            category,
            interests: payload.interests || [],
            country: payload.country,
            priority: payload.priority || notification_interface_1.NotificationPriority.MEDIUM,
            channel: notification_interface_1.NotificationChannel.IN_APP,
            targetAudience: notification_interface_1.TARGET_AUDIENCE.ALL_USER,
            status: notification_interface_1.NotificationStatus.SENT,
            sentAt: new Date(),
            actionUrl: payload.actionUrl,
            actionText: payload.actionText,
            metadata: payload.metadata || {},
            readBy: [],
            archivedBy: [],
        });
        emitBroadcastSocket('notification', {
            type: 'BROADCAST_NOTIFICATION',
            data: notification,
        });
        return notification;
    }
    catch (error) {
        console.error('Failed to dispatch tailored notification:', error);
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, `Failed to dispatch tailored notification: ${error.message}`);
    }
};
exports.NotificationServices = {
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
};
