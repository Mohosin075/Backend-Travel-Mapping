"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const passport_1 = __importDefault(require("passport"));
const user_model_1 = require("../../../user/user.model");
const passport_local_1 = require("passport-local");
const user_1 = require("../../../../enum/user");
const passport_google_oauth20_1 = require("passport-google-oauth20");
const config_1 = __importDefault(require("../../../../config"));
const ApiError_1 = __importDefault(require("../../../../errors/ApiError"));
const http_status_codes_1 = require("http-status-codes");
passport_1.default.use(new passport_local_1.Strategy({
    usernameField: 'email',
    passwordField: 'password',
    passReqToCallback: true,
}, async (req, email, password, done) => {
    try {
        const isUserExist = await user_model_1.User.findOne({
            email: email.trim().toLowerCase(),
            status: { $in: [user_1.USER_STATUS.ACTIVE, user_1.USER_STATUS.INACTIVE, user_1.USER_STATUS.DELETED] },
        })
            .select('+password +authentication')
            .lean();
        if (!isUserExist) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'No account found with this email, please try with valid email or create an account.');
        }
        return done(null, {
            ...isUserExist,
        });
    }
    catch (err) {
        return done(err);
    }
}));
passport_1.default.use(new passport_google_oauth20_1.Strategy({
    clientID: config_1.default.google.client_id,
    clientSecret: config_1.default.google.client_secret,
    callbackURL: config_1.default.google.callback_url,
    passReqToCallback: true,
}, async (req, accessToken, refreshToken, profile, done) => {
    req.body.profile = profile;
    req.body.role = user_1.USER_ROLES.USER;
    try {
        return done(null, req.body);
    }
    catch (err) {
        return done(err);
    }
}));
// Serialize the user
passport_1.default.serializeUser((data, done) => {
    var _a;
    // If we have a DB user, store the _id; otherwise, store the whole object for social-only login
    if ((_a = data.user) === null || _a === void 0 ? void 0 : _a._id) {
        done(null, { type: 'db', id: data.user._id.toString() });
    }
    else {
        done(null, { type: 'social', data }); // store social-only info
    }
});
// Deserialize the user
passport_1.default.deserializeUser(async (payload, done) => {
    try {
        if (!payload)
            return done(null, null);
        if (payload.type === 'db') {
            // Fetch DB user by _id
            const user = await user_model_1.User.findById(payload.id).select('email name role');
            return done(null, user || null);
        }
        else if (payload.type === 'social') {
            // Social-only user, just return stored data
            return done(null, payload.data);
        }
        return done(null, null);
    }
    catch (err) {
        done(err, null);
    }
});
exports.default = passport_1.default;
