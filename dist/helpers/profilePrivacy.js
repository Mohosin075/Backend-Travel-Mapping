"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeReviewIdentity = exports.canSeeProfileIdentity = void 0;
const canSeeProfileIdentity = (subject, requester) => {
    var _a;
    if (!['private', 'anonymous'].includes((_a = subject === null || subject === void 0 ? void 0 : subject.settings) === null || _a === void 0 ? void 0 : _a.profileStatus))
        return true;
    if (['admin', 'super_admin'].includes(requester === null || requester === void 0 ? void 0 : requester.role))
        return true;
    const requesterId = (requester === null || requester === void 0 ? void 0 : requester.authId) || (requester === null || requester === void 0 ? void 0 : requester._id);
    return Boolean(requesterId && (subject === null || subject === void 0 ? void 0 : subject._id) && String(requesterId) === String(subject._id));
};
exports.canSeeProfileIdentity = canSeeProfileIdentity;
const sanitizeReviewIdentity = (value, requester) => {
    const review = typeof (value === null || value === void 0 ? void 0 : value.toObject) === 'function' ? value.toObject() : value;
    if (!(review === null || review === void 0 ? void 0 : review.reviewer) || (0, exports.canSeeProfileIdentity)(review.reviewer, requester))
        return review;
    return { ...review, reviewer: { name: 'Anonymous User', profile: '', isAnonymous: true } };
};
exports.sanitizeReviewIdentity = sanitizeReviewIdentity;
