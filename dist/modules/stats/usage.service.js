"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUniqueUsage = exports.normalizeUsageType = void 0;
const config_1 = __importDefault(require("../../config"));
const jwtHelper_1 = require("../../helpers/jwtHelper");
const business_service_1 = require("../business/business.service");
const map_service_1 = require("../map/map.service");
const place_service_1 = require("../place/place.service");
const usageView_model_1 = require("./usageView.model");
const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const isObjectId = (id) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
const normalizeUsageType = (type) => {
    const value = String(type || '').trim().toLowerCase();
    if (value === 'map')
        return 'map';
    if (value === 'business')
        return 'business';
    if (value === 'place' || value === 'regular')
        return 'place';
    return null;
};
exports.normalizeUsageType = normalizeUsageType;
const readAuthId = (rawToken) => {
    if (!rawToken || typeof rawToken !== 'string')
        return null;
    const token = rawToken.startsWith('Bearer ')
        ? rawToken.slice(7).trim()
        : rawToken.trim();
    if (!token)
        return null;
    try {
        const user = jwtHelper_1.jwtHelper.verifyToken(token, config_1.default.jwt.jwt_secret);
        const authId = (user === null || user === void 0 ? void 0 : user.authId) || (user === null || user === void 0 ? void 0 : user._id) || (user === null || user === void 0 ? void 0 : user.id);
        return authId ? String(authId) : null;
    }
    catch (_a) {
        return null;
    }
};
const handshakeToken = (socket) => {
    var _a, _b, _c;
    const raw = ((_a = socket.handshake.auth) === null || _a === void 0 ? void 0 : _a.token) ||
        ((_b = socket.handshake.query) === null || _b === void 0 ? void 0 : _b.token) ||
        ((_c = socket.handshake.headers) === null || _c === void 0 ? void 0 : _c.authorization);
    return typeof raw === 'string' ? raw : undefined;
};
const viewerKeys = (socket, payload) => {
    const authId = readAuthId(payload === null || payload === void 0 ? void 0 : payload.token) || readAuthId(handshakeToken(socket));
    if (authId) {
        // Authenticated users are tracked strictly by user ID so distinct accounts
        // on the same device/browser are tracked independently.
        return [`user:${authId}`];
    }
    const guestId = String((payload === null || payload === void 0 ? void 0 : payload.visitorId) || '').trim();
    if (guestId && guestId.length >= 8 && guestId.length <= 80) {
        return [`guest:${guestId}`];
    }
    return [];
};
const syncViewerKeys = async (keys, type, entityId, lastSeenAt) => {
    if (keys.length < 2)
        return;
    await usageView_model_1.UsageView.bulkWrite(keys.map(viewerKey => ({
        updateOne: {
            filter: { viewerKey, type, entityId },
            update: { $setOnInsert: { viewerKey, type, entityId, lastSeenAt } },
            upsert: true,
        },
    })), { ordered: false });
};
const incrementCounter = async (type, id) => {
    if (type === 'map')
        return map_service_1.MapService.incrementViewCount(id);
    if (type === 'place')
        return place_service_1.PlaceService.incrementOpenCount(id);
    return business_service_1.BusinessService.incrementViewCount(id);
};
const recordUniqueUsage = async (socket, payload) => {
    const type = (0, exports.normalizeUsageType)(payload === null || payload === void 0 ? void 0 : payload.type);
    const entityId = String((payload === null || payload === void 0 ? void 0 : payload.id) || '').trim();
    const keys = viewerKeys(socket, payload);
    if (!type || !isObjectId(entityId) || keys.length === 0)
        return;
    const now = new Date();
    const cutoff = new Date(now.getTime() - VIEW_WINDOW_MS);
    const existing = await usageView_model_1.UsageView.find({
        viewerKey: { $in: keys },
        type,
        entityId,
    })
        .sort({ lastSeenAt: -1 })
        .lean();
    const latest = existing[0];
    if (latest && latest.lastSeenAt && latest.lastSeenAt >= cutoff) {
        await syncViewerKeys(keys, type, entityId, latest.lastSeenAt);
        return;
    }
    try {
        if (latest) {
            const updated = await usageView_model_1.UsageView.findOneAndUpdate({ _id: latest._id, lastSeenAt: { $lte: cutoff } }, { $set: { lastSeenAt: now } }, { new: true });
            if (!updated)
                return;
        }
        else {
            await usageView_model_1.UsageView.create({
                viewerKey: keys[0],
                type,
                entityId,
                lastSeenAt: now,
            });
        }
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) === 11000)
            return;
        throw error;
    }
    try {
        await incrementCounter(type, entityId);
        await syncViewerKeys(keys, type, entityId, now);
    }
    catch (error) {
        await usageView_model_1.UsageView.deleteMany({
            viewerKey: { $in: keys },
            type,
            entityId,
            lastSeenAt: now,
        });
        throw error;
    }
};
exports.recordUniqueUsage = recordUniqueUsage;
