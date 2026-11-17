"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenServices = void 0;
const mongoose_1 = require("mongoose");
const token_model_1 = require("./token.model");
const logout = async (userId) => {
    const res = await token_model_1.Token.updateOne({
        user: new mongoose_1.Types.ObjectId(userId),
    }, {
        expireAt: new Date(Date.now()),
        token: '',
    });
    return res;
};
exports.TokenServices = {
    logout,
};
