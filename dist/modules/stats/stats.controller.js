"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsController = void 0;
const http_status_codes_1 = require("http-status-codes");
const catchAsync_1 = __importDefault(require("../../shared/catchAsync"));
const sendResponse_1 = __importDefault(require("../../shared/sendResponse"));
const stats_service_1 = require("./stats.service");
const activity_service_1 = require("./activity.service");
const usage_service_1 = require("./usage.service");
const stats_events_1 = require("./stats-events");
const notify = () => (0, stats_events_1.notifyStatsUpdated)(global.io);
const recordActivity = (0, catchAsync_1.default)(async (req, res) => {
    if (await (0, activity_service_1.recordAuthenticatedActivity)(req.headers.authorization))
        notify();
    (0, sendResponse_1.default)(res, { statusCode: http_status_codes_1.StatusCodes.OK, success: true, message: 'Activity recorded', data: null });
});
const recordUsage = (0, catchAsync_1.default)(async (req, res) => {
    // HTTP fallback works when a proxy blocks sockets. Never trust a body-supplied identity.
    const { type, id, visitorId } = req.body || {};
    await (0, usage_service_1.recordUniqueUsage)({ handshake: { auth: {}, query: {}, headers: {} } }, {
        type, id, visitorId, token: req.headers.authorization || '',
    });
    notify();
    (0, sendResponse_1.default)(res, { statusCode: http_status_codes_1.StatusCodes.OK, success: true, message: 'Usage recorded', data: null });
});
const getDashboardData = (0, catchAsync_1.default)(async (req, res) => {
    const result = await stats_service_1.StatsService.getDashboardData();
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Dashboard data fetched successfully',
        data: result,
    });
});
const getReportsData = (0, catchAsync_1.default)(async (req, res) => {
    const result = await stats_service_1.StatsService.getReportsData(req.query);
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Reports data fetched successfully',
        data: result,
    });
});
const searchReportEntities = (0, catchAsync_1.default)(async (req, res) => {
    const result = await stats_service_1.StatsService.searchReportEntities(String(req.query.searchTerm || ''));
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Report search suggestions fetched successfully',
        data: result,
    });
});
const getEntityUsers = (0, catchAsync_1.default)(async (req, res) => {
    const { type, id } = req.query;
    const result = await stats_service_1.StatsService.getEntityUsers(String(type || ''), String(id || ''), String(req.query.timeFilter || ''));
    (0, sendResponse_1.default)(res, {
        statusCode: http_status_codes_1.StatusCodes.OK,
        success: true,
        message: 'Entity users fetched successfully',
        data: result,
    });
});
const getRegisteredUsers = (0, catchAsync_1.default)(async (req, res) => {
    const result = await stats_service_1.StatsService.getRegisteredUsers(req.query);
    (0, sendResponse_1.default)(res, { statusCode: http_status_codes_1.StatusCodes.OK, success: true,
        message: 'Registered users fetched successfully', data: result });
});
exports.StatsController = {
    getRegisteredUsers,
    recordActivity,
    recordUsage,
    getDashboardData,
    getReportsData,
    searchReportEntities,
    getEntityUsers,
};
