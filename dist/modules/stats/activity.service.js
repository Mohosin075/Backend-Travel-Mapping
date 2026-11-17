"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAuthenticatedActivity = void 0;
const config_1 = __importDefault(require("../../config"));
const jwtHelper_1 = require("../../helpers/jwtHelper");
const user_model_1 = require("../user/user.model");
/** Keep activity separate from profile edits; write at most once per 25 seconds. */
const recordAuthenticatedActivity = async (token) => {
    if (!token)
        return false;
    let user;
    try {
        user = jwtHelper_1.jwtHelper.verifyToken(token.replace(/^Bearer\s+/i, ''), config_1.default.jwt.jwt_secret);
    }
    catch (_a) {
        return false;
    }
    if (!(user === null || user === void 0 ? void 0 : user.authId) || !/^[a-f\d]{24}$/i.test(String(user.authId)))
        return false;
    const now = new Date();
    const result = await user_model_1.User.updateOne({
        _id: user.authId, status: { $ne: 'deleted' },
        $or: [{ lastActiveAt: { $exists: false } }, { lastActiveAt: { $lt: new Date(now.getTime() - 25000) } }],
    }, { $set: { lastActiveAt: now } }, { timestamps: false });
    return result.modifiedCount > 0;
};
exports.recordAuthenticatedActivity = recordAuthenticatedActivity;
