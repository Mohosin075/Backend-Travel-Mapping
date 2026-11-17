"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomAuthServices = void 0;
const http_status_codes_1 = require("http-status-codes");
const user_model_1 = require("../../user/user.model");
const auth_helper_1 = require("../auth.helper");
const ApiError_1 = __importDefault(require("../../../errors/ApiError"));
const user_1 = require("../../../enum/user");
const config_1 = __importDefault(require("../../../config"));
const token_model_1 = require("../../token/token.model");
const emailTemplate_1 = require("../../../shared/emailTemplate");
const crypto_1 = __importStar(require("../../../utils/crypto"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const common_1 = require("../common");
const jwtHelper_1 = require("../../../helpers/jwtHelper");
const emailHelper_1 = require("../../../helpers/emailHelper");
// import { emailQueue } from '../../../helpers/bull-mq-producer'
const createUser = async (payload) => {
    var _a;
    payload.email = (_a = payload.email) === null || _a === void 0 ? void 0 : _a.toLowerCase().trim();
    const isUserExist = await user_model_1.User.findOne({
        email: payload.email,
    });
    if (isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, isUserExist.status === user_1.USER_STATUS.DELETED
            ? 'This account has been deleted. Please contact support or use another email.'
            : 'An account with this email already exists. Please log in or use another email.');
    }
    const otp = (0, crypto_1.generateOtp)();
    const otpExpiresIn = new Date(Date.now() + 5 * 60 * 1000);
    const authentication = {
        email: payload.email,
        oneTimeCode: otp,
        expiresAt: otpExpiresIn,
        latestRequestAt: new Date(),
        requestCount: 1,
        authType: 'createAccount',
        isVerified: false,
    };
    // Send email with OTP
    const createAccount = emailTemplate_1.emailTemplate.createAccount({
        name: payload.name,
        email: payload.email.toLowerCase().trim(),
        otp,
    });
    const user = await user_model_1.User.create({
        ...payload,
        password: payload.password,
        authentication,
    });
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to create user.');
    }
    // Do not send a signup code for an insert that failed (including duplicate races).
    void emailHelper_1.emailHelper.sendEmail(createAccount);
    return {
        success: true,
        message: 'Registration successful and OTP sent to your email',
        data: {
            email: user.email,
        },
    };
};
const customLogin = async (payload) => {
    const { email, phone } = payload;
    const query = email ? { email: email.toLowerCase().trim() } : { phone: phone };
    const isUserExist = await user_model_1.User.findOne({
        ...query,
        status: { $in: [user_1.USER_STATUS.ACTIVE, user_1.USER_STATUS.INACTIVE, user_1.USER_STATUS.DELETED] },
    })
        .select('+password +authentication')
        .lean();
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, `No account found with this ${email ? 'email' : 'phone'}`);
    }
    if (isUserExist.status === user_1.USER_STATUS.DELETED) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This account has been deleted. Please contact support or use another email.');
    }
    // This endpoint previously accepted active accounts only. Keep that policy.
    if (isUserExist.status === user_1.USER_STATUS.INACTIVE) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Your account is inactive. Please contact support.');
    }
    if (!isUserExist.password && isUserExist.provider !== 'guest_purchase') {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'It seems you have signed up using social login. Please use social login to access your account.');
    }
    const result = await common_1.AuthCommonServices.handleLoginLogic(payload, isUserExist);
    return result;
};
const adminLogin = async (payload) => {
    const { email, phone } = payload;
    const query = email ? { email: email.trim().toLowerCase() } : { phone: phone };
    const isUserExist = await user_model_1.User.findOne({
        ...query,
    })
        .select('+password +authentication')
        .lean();
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, `No account found with this ${email ? 'email' : 'phone'}`);
    }
    if (isUserExist.role !== user_1.USER_ROLES.ADMIN) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You are not authorized to login as admin');
    }
    const isPasswordMatch = await auth_helper_1.AuthHelper.isPasswordMatched(payload.password, isUserExist.password);
    if (!isPasswordMatch) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'Please try again with correct credentials.');
    }
    //tokens
    const tokens = auth_helper_1.AuthHelper.createToken(isUserExist._id, isUserExist.role, isUserExist.name, isUserExist.email);
    return (0, common_1.authResponse)(http_status_codes_1.StatusCodes.OK, `Welcome back ${isUserExist.name}`, isUserExist.role, tokens.accessToken, tokens.refreshToken);
};
const forgetPassword = async (email, phone) => {
    const query = email
        ? { email: email.toLocaleLowerCase().trim() }
        : { phone: phone };
    const isUserExist = await user_model_1.User.findOne({
        ...query,
        status: { $in: [user_1.USER_STATUS.ACTIVE, user_1.USER_STATUS.INACTIVE, user_1.USER_STATUS.DELETED] },
    });
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, `No account found with this ${email ? 'email' : 'phone'}. Please check it or create an account.`);
    }
    if (isUserExist.status === user_1.USER_STATUS.DELETED) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This account has been deleted. Please contact support or use another email.');
    }
    const otp = (0, crypto_1.generateOtp)();
    if (phone) {
        // implement SMS OTP via SMS provider if needed
    }
    const authentication = {
        email: isUserExist.email,
        resetPassword: true,
        oneTimeCode: otp,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        latestRequestAt: new Date(),
        requestCount: 1,
        authType: 'resetPassword',
    };
    await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
        $set: { authentication: authentication },
    }, { new: true });
    // //send otp to user
    if (email) {
        const forgetPasswordEmailTemplate = emailTemplate_1.emailTemplate.resetPassword({
            name: isUserExist.name || 'viajero',
            email: isUserExist.email,
            otp,
            isSetup: !isUserExist.password,
        });
        emailHelper_1.emailHelper.sendEmail(forgetPasswordEmailTemplate);
    }
    return 'OTP sent successfully.';
};
const resetPassword = async (resetToken, payload) => {
    const { newPassword, confirmPassword } = payload;
    if (newPassword !== confirmPassword) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Passwords do not match');
    }
    const isTokenExist = await token_model_1.Token.findOne({ token: resetToken }).lean();
    if (!isTokenExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, "You don't have authorization to reset your password, please verify your account first.");
    }
    const isUserExist = await user_model_1.User.findById(isTokenExist.user)
        .select('+authentication')
        .lean();
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Something went wrong, please try again. or contact support.');
    }
    const { authentication } = isUserExist;
    if (!(authentication === null || authentication === void 0 ? void 0 : authentication.resetPassword)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You don\'t have permission to change the password. Please click again to "Forgot Password"');
    }
    const isTokenValid = (isTokenExist === null || isTokenExist === void 0 ? void 0 : isTokenExist.expireAt) > new Date();
    if (!isTokenValid) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Your reset token has expired, please try again.');
    }
    const hashPassword = await bcrypt_1.default.hash(newPassword, Number(config_1.default.bcrypt_salt_rounds));
    const updatedUserData = {
        password: hashPassword,
        verified: true, // Mark as verified when setting password for the first time
        authentication: {
            resetPassword: false,
            otp: '',
            expiresAt: null,
            latestRequestAt: null,
            requestCount: 0,
            authType: '',
        },
    };
    const consumedToken = await token_model_1.Token.findOneAndDelete({ token: resetToken, user: isUserExist._id,
        expireAt: { $gt: new Date() } });
    if (!consumedToken)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This reset token was already used or expired. Please request a new code.');
    await user_model_1.User.findByIdAndUpdate(isUserExist._id, { $set: updatedUserData }, { new: true });
    return { message: 'Password reset successfully' };
};
const verifyAccount = async (email, onetimeCode, password) => {
    var _a;
    //verify fo new user
    if (!onetimeCode) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'OTP is required.');
    }
    const isUserExist = await user_model_1.User.findOne({
        email: email.toLowerCase().trim(),
        status: { $nin: [user_1.USER_STATUS.DELETED] },
    }).select('+password +authentication');
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, `No account found with this ${email}, please register first.`);
    }
    const { authentication } = isUserExist;
    // Normalize: digits only (handles number/string and stray whitespace)
    const storedOtp = String((_a = authentication === null || authentication === void 0 ? void 0 : authentication.oneTimeCode) !== null && _a !== void 0 ? _a : '').replace(/\D/g, '');
    const providedOtp = String(onetimeCode !== null && onetimeCode !== void 0 ? onetimeCode : '').replace(/\D/g, '');
    if (!storedOtp) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'No active code found. Please use Resend Code or request a new invitation.');
    }
    if (storedOtp !== providedOtp) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid or outdated code. Use the code from your latest email, or tap Resend Code.');
    }
    const currentDate = new Date();
    if (!(authentication === null || authentication === void 0 ? void 0 : authentication.expiresAt) || new Date(authentication.expiresAt).getTime() <= currentDate.getTime()) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'OTP has expired, please try again.');
    }
    // Consume the code atomically before any account/login/reset-token action.
    // A signup verification code must not be replayable as a password-reset code.
    const consumed = await user_model_1.User.findOneAndUpdate({
        _id: isUserExist._id,
        status: { $nin: [user_1.USER_STATUS.DELETED] },
        'authentication.oneTimeCode': authentication.oneTimeCode,
        'authentication.expiresAt': { $gt: currentDate },
    }, { $set: { 'authentication.oneTimeCode': '' } }, { new: true });
    if (!consumed)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This code was already used or expired. Please request a new code.');
    //either newly created user or existing user
    if (!isUserExist.verified && authentication.authType !== 'resetPassword' && !authentication.resetPassword) {
        // If user was invited (has no password), they must set a password first
        if (!isUserExist.password) {
            if (password) {
                // If password is provided during OTP verification (Invitation acceptance)
                isUserExist.password = password;
                isUserExist.verified = true;
                isUserExist.authentication = {
                    oneTimeCode: '',
                    expiresAt: null,
                    latestRequestAt: null,
                    requestCount: 0,
                    authType: 'createAccount',
                    resetPassword: false,
                };
                await isUserExist.save();
                const tokens = auth_helper_1.AuthHelper.createToken(isUserExist._id, isUserExist.role, isUserExist.name, isUserExist.email);
                return (0, common_1.authResponse)(http_status_codes_1.StatusCodes.OK, `Welcome ${isUserExist.name} to our platform. Your account is now verified and password set.`, isUserExist.role, tokens.accessToken, tokens.refreshToken);
            }
            else {
                // If password is NOT provided, return the reset token to set password
                await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
                    $set: {
                        authentication: {
                            oneTimeCode: '',
                            expiresAt: null,
                            latestRequestAt: null,
                            requestCount: 0,
                            authType: '',
                            resetPassword: true,
                        },
                    },
                }, { new: true });
                const token = await token_model_1.Token.create({
                    token: (0, crypto_1.default)(),
                    user: isUserExist._id,
                    expireAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
                });
                return (0, common_1.authResponse)(http_status_codes_1.StatusCodes.OK, 'OTP verified successfully, please set your password to complete your account.', undefined, undefined, undefined, token === null || token === void 0 ? void 0 : token.token, true);
            }
        }
        // Normal signup flow (already has password)
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, { $set: { verified: true } }, { new: true });
        const tokens = auth_helper_1.AuthHelper.createToken(isUserExist._id, isUserExist.role, isUserExist.name, isUserExist.email);
        return (0, common_1.authResponse)(http_status_codes_1.StatusCodes.OK, `Welcome ${isUserExist.name} to our platform.`, isUserExist.role, tokens.accessToken, tokens.refreshToken);
    }
    else {
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
            $set: {
                authentication: {
                    oneTimeCode: '',
                    expiresAt: null,
                    latestRequestAt: null,
                    requestCount: 0,
                    authType: '',
                    resetPassword: true,
                },
            },
        }, { new: true });
        const token = await token_model_1.Token.create({
            token: (0, crypto_1.default)(),
            user: isUserExist._id,
            expireAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        });
        if (!token) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Something went wrong, please try again. or contact support.');
        }
        return (0, common_1.authResponse)(http_status_codes_1.StatusCodes.OK, 'OTP verified successfully, please reset your password.', undefined, undefined, undefined, token === null || token === void 0 ? void 0 : token.token, true);
    }
};
const getRefreshToken = async (token) => {
    try {
        const decodedToken = jwtHelper_1.jwtHelper.verifyToken(token, config_1.default.jwt.jwt_refresh_secret);
        // Current tokens use authId; retain support for older userId tokens.
        const userId = decodedToken.authId || decodedToken.userId;
        if (!userId)
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Invalid Refresh Token');
        const currentUser = await user_model_1.User.findById(userId);
        if (!currentUser || currentUser.status !== user_1.USER_STATUS.ACTIVE) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This account is no longer active. Please sign in again.');
        }
        const tokens = auth_helper_1.AuthHelper.createToken(userId, currentUser.role, currentUser.name, currentUser.email);
        return {
            accessToken: tokens.accessToken,
        };
    }
    catch (error) {
        if (error instanceof Error && error.name === 'TokenExpiredError') {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'Refresh Token has expired');
        }
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Invalid Refresh Token');
    }
};
const socialLogin = async (appId, deviceToken) => {
    const isUserExist = await user_model_1.User.findOne({
        appId,
        status: { $in: [user_1.USER_STATUS.ACTIVE, user_1.USER_STATUS.INACTIVE] },
    });
    if (!isUserExist) {
        const createdUser = await user_model_1.User.create({
            appId,
            deviceToken,
            status: user_1.USER_STATUS.ACTIVE,
            password: crypto.randomUUID(),
        });
        if (!createdUser)
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to create user.');
        const tokens = auth_helper_1.AuthHelper.createToken(createdUser._id, createdUser.role, createdUser.name, createdUser.email);
        return (0, common_1.authResponse)(http_status_codes_1.StatusCodes.OK, `Welcome ${createdUser.name} to our platform.`, createdUser.role, tokens.accessToken, tokens.refreshToken);
    }
    else {
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
            $set: {
                deviceToken,
            },
        });
        const tokens = auth_helper_1.AuthHelper.createToken(isUserExist._id, isUserExist.role, isUserExist.name, isUserExist.email);
        //send token to client
        return (0, common_1.authResponse)(http_status_codes_1.StatusCodes.OK, `Welcome back ${isUserExist.name}`, isUserExist.role, tokens.accessToken, tokens.refreshToken);
    }
};
const resendOtpToPhoneOrEmail = async (authType, email, phone) => {
    const query = email ? { email: email } : { phone: phone };
    const isUserExist = await user_model_1.User.findOne({
        ...query,
        status: { $in: [user_1.USER_STATUS.ACTIVE, user_1.USER_STATUS.INACTIVE] },
    }).select('+authentication');
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, `No account found with this ${email ? 'email' : 'phone'}`);
    }
    //check the request count
    const { authentication } = isUserExist;
    if ((authentication === null || authentication === void 0 ? void 0 : authentication.requestCount) >= 5) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You have exceeded the maximum number of requests. Please try again later.');
    }
    const otp = (0, crypto_1.generateOtp)();
    const updatedAuthentication = {
        oneTimeCode: otp,
        latestRequestAt: new Date(),
        requestCount: (authentication === null || authentication === void 0 ? void 0 : authentication.requestCount) + 1,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    };
    //send otp to user
    if (email) {
        const forgetPasswordEmailTemplate = emailTemplate_1.emailTemplate.resendOtp({
            email: isUserExist.email,
            name: isUserExist.name,
            otp,
            type: authType === 'resetPassword' && !isUserExist.password ? 'setPassword' : authType,
        });
        // emailQueue.add('emails', forgetPasswordEmailTemplate)
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
            $set: { authentication: updatedAuthentication },
        }, { new: true });
    }
    // TODO : need mobile varificaition implementation after signup with phone
    if (phone) {
        // implement SMS OTP via SMS provider if needed
        await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
            $set: { authentication: updatedAuthentication },
        }, { new: true });
    }
};
const deleteAccount = async (user, password) => {
    const { authId } = user;
    const isUserExist = await user_model_1.User.findById(authId).select('+password');
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Failed to delete account. Please try again.');
    }
    if (isUserExist.status === user_1.USER_STATUS.DELETED) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Requested user is already deleted.');
    }
    const isPasswordMatched = await bcrypt_1.default.compare(password, isUserExist.password);
    if (!isPasswordMatched) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Please provide a valid password to delete your account.');
    }
    const deletedData = await user_model_1.User.findByIdAndUpdate(authId, {
        $set: { status: user_1.USER_STATUS.DELETED },
    });
    return {
        status: http_status_codes_1.StatusCodes.OK,
        message: 'Account deleted successfully.',
        deletedData,
    };
};
const resendOtp = async (email, authType) => {
    const isUserExist = await user_model_1.User.findOne({
        email: email.toLowerCase().trim(),
        status: { $in: [user_1.USER_STATUS.ACTIVE, user_1.USER_STATUS.INACTIVE, user_1.USER_STATUS.DELETED] },
    }).select('+password +authentication');
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'No account found with this email. Please check it or create an account.');
    }
    if (isUserExist.status === user_1.USER_STATUS.DELETED) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This account has been deleted. Please contact support or use another email.');
    }
    const { authentication } = isUserExist;
    const nextRequestCount = ((authentication === null || authentication === void 0 ? void 0 : authentication.requestCount) || 0) + 1;
    if (nextRequestCount > 5) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'You have exceeded the maximum number of requests. Please try again later.');
    }
    // Invited users (unverified, no password) keep the longer invite window
    const isInviteAccept = !isUserExist.verified && !isUserExist.password && authType === 'createAccount';
    const expiresAt = new Date(Date.now() + (isInviteAccept ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000));
    const otp = (0, crypto_1.generateOtp)();
    const authenticationPayload = {
        oneTimeCode: otp,
        latestRequestAt: new Date(),
        requestCount: nextRequestCount,
        expiresAt,
        authType,
        resetPassword: authType === 'resetPassword',
    };
    await user_model_1.User.findByIdAndUpdate(isUserExist._id, {
        $set: { authentication: authenticationPayload },
    }, { new: true });
    if (email) {
        const forgetPasswordEmailTemplate = emailTemplate_1.emailTemplate.resendOtp({
            email: email,
            name: isUserExist.name || 'there',
            otp,
            type: authType,
        });
        emailHelper_1.emailHelper.sendEmail(forgetPasswordEmailTemplate);
    }
    return 'OTP sent successfully.';
};
const changePassword = async (user, currentPassword, newPassword) => {
    // Find the user with password field
    const isUserExist = await user_model_1.User.findById(user.authId)
        .select('+password')
        .lean();
    if (!isUserExist) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    // Check if current password matches
    const isPasswordMatch = await auth_helper_1.AuthHelper.isPasswordMatched(currentPassword, isUserExist.password);
    if (!isPasswordMatch) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Current password is incorrect');
    }
    // Hash the new password
    const hashedPassword = await bcrypt_1.default.hash(newPassword, Number(config_1.default.bcrypt_salt_rounds));
    // Update the password
    await user_model_1.User.findByIdAndUpdate(user.authId, { password: hashedPassword }, { new: true });
    return { message: 'Password changed successfully' };
};
exports.CustomAuthServices = {
    adminLogin,
    forgetPassword,
    resetPassword,
    verifyAccount,
    customLogin,
    getRefreshToken,
    socialLogin,
    resendOtpToPhoneOrEmail,
    deleteAccount,
    resendOtp,
    changePassword,
    createUser,
};
