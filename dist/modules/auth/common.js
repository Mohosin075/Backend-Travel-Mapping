"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authResponse = exports.AuthCommonServices = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const user_1 = require("../../enum/user");
const user_model_1 = require("../user/user.model");
const auth_helper_1 = require("./auth.helper");
const crypto_1 = require("../../utils/crypto");
const emailTemplate_1 = require("../../shared/emailTemplate");
const emailHelper_1 = require("../../helpers/emailHelper");
// import { emailQueue } from '../../helpers/bull-mq-producer'
const handleLoginLogic = async (payload, isUserExist) => {
    const { verified, status, password } = isUserExist;
    const authentication = isUserExist.authentication || {};
    isUserExist.authentication = authentication;
    const { restrictionLeftAt, wrongLoginAttempts = 0 } = authentication;
    if (status === user_1.USER_STATUS.DELETED) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This account has been deleted. Please contact support or use another email.');
    }
    if (status === user_1.USER_STATUS.INACTIVE) {
        if (restrictionLeftAt && new Date() < restrictionLeftAt) {
            const remainingMinutes = Math.ceil((restrictionLeftAt.getTime() - Date.now()) / 60000);
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.TOO_MANY_REQUESTS, `You are restricted to login for ${remainingMinutes} minutes`);
        }
        // Handle restriction expiration
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
            $set: {
                'authentication.restrictionLeftAt': null,
                'authentication.wrongLoginAttempts': 0,
                status: user_1.USER_STATUS.ACTIVE,
            },
        });
    }
    if (!password && isUserExist.provider === 'guest_purchase') {
        return {
            status: http_status_codes_1.StatusCodes.OK,
            message: "You haven't set a password yet. Verify your email to set one.",
            passwordSetupRequired: true,
        };
    }
    if (!password && verified) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This account has no password. Continue with Google or verify your email to set a password.');
    }
    // Existing password accounts must prove their password before receiving a
    // signup verification redirect. Passwordless invitations keep their OTP flow.
    const isPasswordMatched = !password || await user_model_1.User.isPasswordMatched(payload.password, password);
    if (!isPasswordMatched) {
        isUserExist.authentication.wrongLoginAttempts = wrongLoginAttempts + 1;
        if (isUserExist.authentication.wrongLoginAttempts >= 5) {
            isUserExist.status = user_1.USER_STATUS.INACTIVE;
            isUserExist.authentication.restrictionLeftAt = new Date(Date.now() + 10 * 60 * 1000); // restriction for 10 minutes
        }
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
            $set: {
                status: isUserExist.status,
                'authentication.restrictionLeftAt': isUserExist.authentication.restrictionLeftAt,
                'authentication.wrongLoginAttempts': isUserExist.authentication.wrongLoginAttempts,
            },
        });
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Incorrect password, please try again.');
    }
    if (!verified) {
        const isInviteAccept = !password;
        const otp = (0, crypto_1.generateOtp)();
        const otpExpiresIn = new Date(Date.now() + (isInviteAccept ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000));
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, { $set: { authentication: {
                    email: isUserExist.email, oneTimeCode: otp, expiresAt: otpExpiresIn,
                    latestRequestAt: new Date(), authType: 'createAccount',
                } } });
        const template = isInviteAccept
            ? emailTemplate_1.emailTemplate.userInvitation({ email: isUserExist.email, role: isUserExist.role || 'user', otp })
            : emailTemplate_1.emailTemplate.createAccount({ name: isUserExist.name || 'there', email: isUserExist.email, otp });
        emailHelper_1.emailHelper.sendEmail(template);
        return (0, exports.authResponse)(http_status_codes_1.StatusCodes.OK, `An OTP has been sent to your ${isUserExist.email}. Please verify.`, undefined, undefined, undefined, undefined, isInviteAccept);
    }
    await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
        $set: {
            deviceToken: payload.deviceToken,
            'authentication.restrictionLeftAt': null,
            'authentication.wrongLoginAttempts': 0,
        },
    }, { new: true });
    const rememberMe = payload.rememberMe || false;
    const tokens = auth_helper_1.AuthHelper.createToken(isUserExist._id, isUserExist.role, isUserExist.name, isUserExist.email, payload.deviceToken, rememberMe);
    return (0, exports.authResponse)(http_status_codes_1.StatusCodes.OK, `Welcome back ${isUserExist.name}`, isUserExist.role, tokens.accessToken, tokens.refreshToken);
};
exports.AuthCommonServices = {
    handleLoginLogic,
};
const authResponse = (status, message, role, accessToken, refreshToken, token, needPassword) => {
    return {
        status,
        message,
        ...(role && { role }),
        ...(accessToken && { accessToken }),
        ...(refreshToken && { refreshToken }),
        ...(token && { token }),
        ...(needPassword !== undefined && { needPassword }),
    };
};
exports.authResponse = authResponse;
