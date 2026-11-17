"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOfferMapIdAsync = exports.resolveOfferMapId = exports.buildCountryToMapIdLookup = exports.getDirectOfferMapId = exports.verifyEditorBusinessAccess = exports.verifyEditorEditAccess = exports.getAccessibleMapIds = exports.getUserFromToken = void 0;
const config_1 = __importDefault(require("../config"));
const jwtHelper_1 = require("./jwtHelper");
const user_model_1 = require("../modules/user/user.model");
const map_model_1 = require("../modules/map/map.model");
const user_1 = require("../enum/user");
const localize_1 = require("./localize");
const getUserFromToken = async (authorizationHeader) => {
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authorizationHeader.split(' ')[1];
    if (!token)
        return null;
    try {
        const verified = jwtHelper_1.jwtHelper.verifyToken(token, config_1.default.jwt.jwt_secret);
        if (!verified || !verified.authId)
            return null;
        const user = await user_model_1.User.findById(verified.authId);
        return user;
    }
    catch (err) {
        return null;
    }
};
exports.getUserFromToken = getUserFromToken;
const getAccessibleMapIds = async (user) => {
    // Admin / Super Admin — all maps
    if (user && [user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN].includes(user.role)) {
        const allMaps = await map_model_1.Map.find({}, '_id');
        return allMaps.map(m => m._id.toString());
    }
    // Ensure full user data is available if user was passed from req.user (JwtPayload)
    let fullUser = user;
    if (user && !user.assignedMaps && !user.purchasedMaps && (user.authId || user._id)) {
        fullUser = (await user_model_1.User.findById(user.authId || user._id)) || user;
    }
    // Map Editor — only assigned maps + maps in assigned countries
    if (fullUser && fullUser.role === user_1.USER_ROLES.MAP_EDITOR) {
        const assignedMapIds = (fullUser.assignedMaps || [])
            .map((id) => ((id === null || id === void 0 ? void 0 : id._id) ? id._id.toString() : id === null || id === void 0 ? void 0 : id.toString()))
            .filter(Boolean);
        const assignedCountries = (fullUser.assignedCountries || []).filter((country) => typeof country === 'string' && Boolean(country.trim()));
        let countryMapIds = [];
        if (assignedCountries.length > 0) {
            const countryRegexes = assignedCountries.map((c) => new RegExp('^' + c.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'));
            const countryMaps = await map_model_1.Map.find({
                $or: [
                    { country: { $in: countryRegexes } },
                    { 'name.en': { $in: countryRegexes } },
                    { 'name.es': { $in: countryRegexes } },
                    { name: { $in: countryRegexes } },
                ],
            }, '_id');
            countryMapIds = countryMaps.map(m => m._id.toString());
        }
        return Array.from(new Set([...assignedMapIds, ...countryMapIds]));
    }
    // Find all free maps
    const freeMaps = await map_model_1.Map.find({ isPaid: false }, '_id');
    const freeMapIds = freeMaps.map(m => m._id.toString());
    // If user is logged in, append purchased maps
    if (fullUser && fullUser.purchasedMaps) {
        const purchasedMapIds = fullUser.purchasedMaps.map((id) => id.toString());
        return Array.from(new Set([...freeMapIds, ...purchasedMapIds]));
    }
    return freeMapIds;
};
exports.getAccessibleMapIds = getAccessibleMapIds;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../errors/ApiError"));
const verifyEditorEditAccess = async (user, mapId) => {
    var _a, _b, _c;
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'You are not authorized.');
    }
    // Admin and Super Admin have full access
    if ([user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN].includes(user.role)) {
        return true;
    }
    let fullUser = user;
    if (!user.assignedMaps && (user.authId || user._id)) {
        fullUser = (await user_model_1.User.findById(user.authId || user._id)) || user;
    }
    // If Map Editor, check assigned maps and countries
    if (fullUser.role === user_1.USER_ROLES.MAP_EDITOR) {
        const map = await map_model_1.Map.findById(mapId);
        if (!map) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found.');
        }
        const mapIdStr = map._id.toString();
        const mapCountry = map.country;
        const mapNameEn = typeof map.name === 'object' ? (_a = map.name) === null || _a === void 0 ? void 0 : _a.en : map.name;
        const mapNameEs = typeof map.name === 'object' ? (_b = map.name) === null || _b === void 0 ? void 0 : _b.es : map.name;
        const isAssignedMap = (_c = fullUser.assignedMaps) === null || _c === void 0 ? void 0 : _c.some((id) => ((id === null || id === void 0 ? void 0 : id._id) ? id._id.toString() : id === null || id === void 0 ? void 0 : id.toString()) === mapIdStr);
        const matchesCountry = (val) => {
            var _a;
            if (!val || typeof val !== 'string')
                return false;
            const lower = val.trim().toLowerCase();
            return (_a = fullUser.assignedCountries) === null || _a === void 0 ? void 0 : _a.some((c) => typeof c === 'string' && c.trim().toLowerCase() === lower);
        };
        const isAssignedCountry = matchesCountry(mapCountry) ||
            matchesCountry(mapNameEn) ||
            matchesCountry(mapNameEs);
        if (isAssignedMap || isAssignedCountry) {
            return true;
        }
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized to edit this map or its places.');
    }
    throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You do not have permission to edit this resource.');
};
exports.verifyEditorEditAccess = verifyEditorEditAccess;
/**
 * Business docs store location.country as map name OR geographic country.
 * Allow access if:
 * - assignedCountries includes that value, OR
 * - any assigned map's name or country matches that value
 */
const verifyEditorBusinessAccess = async (user, businessCountry) => {
    var _a;
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'You are not authorized.');
    }
    if ([user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN].includes(user.role)) {
        return true;
    }
    let fullUser = user;
    if (!user.assignedMaps && (user.authId || user._id)) {
        fullUser = (await user_model_1.User.findById(user.authId || user._id)) || user;
    }
    if (fullUser.role !== user_1.USER_ROLES.MAP_EDITOR) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You do not have permission to edit this resource.');
    }
    const country = (businessCountry || '').trim();
    if (!country) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized to edit offers for this business.');
    }
    if ((_a = fullUser.assignedCountries) === null || _a === void 0 ? void 0 : _a.includes(country)) {
        return true;
    }
    const assignedMapIds = (fullUser.assignedMaps || []).map((id) => id.toString());
    if (assignedMapIds.length > 0) {
        const maps = await map_model_1.Map.find({ _id: { $in: assignedMapIds } }).select('name country');
        const matchesAssignedMap = maps.some(m => m.name === country || m.country === country);
        if (matchesAssignedMap) {
            return true;
        }
    }
    // Country assignment may be geographic (e.g. "United States") while
    // business.location.country stores the map name ("Estados Unidos")
    const countryMaps = (user.assignedCountries || []).length > 0
        ? await map_model_1.Map.find({ country: { $in: user.assignedCountries } }).select('name country')
        : [];
    if (countryMaps.some(m => m.name === country || m.country === country)) {
        return true;
    }
    throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You are not authorized to edit offers for this business.');
};
exports.verifyEditorBusinessAccess = verifyEditorBusinessAccess;
/** Direct map id from place/business populate (when present). */
const getDirectOfferMapId = (offer) => {
    var _a, _b, _c, _d, _e, _f;
    const placeMap = ((_b = (_a = offer === null || offer === void 0 ? void 0 : offer.place) === null || _a === void 0 ? void 0 : _a.map) === null || _b === void 0 ? void 0 : _b._id) || ((_c = offer === null || offer === void 0 ? void 0 : offer.place) === null || _c === void 0 ? void 0 : _c.map);
    if (placeMap)
        return placeMap.toString();
    const businessMap = ((_e = (_d = offer === null || offer === void 0 ? void 0 : offer.business) === null || _d === void 0 ? void 0 : _d.map) === null || _e === void 0 ? void 0 : _e._id) || ((_f = offer === null || offer === void 0 ? void 0 : offer.business) === null || _f === void 0 ? void 0 : _f.map);
    if (businessMap)
        return businessMap.toString();
    return null;
};
exports.getDirectOfferMapId = getDirectOfferMapId;
/**
 * Businesses store location.country as map name or geographic country.
 * Build name/country → mapId lookup for batch lock checks.
 */
const buildCountryToMapIdLookup = async (countries) => {
    const unique = Array.from(new Set(countries.map(c => (c || '').trim()).filter(Boolean)));
    if (unique.length === 0)
        return {};
    const maps = await map_model_1.Map.find({
        $or: [{ name: { $in: unique } }, { country: { $in: unique } }],
    }).select('_id name country');
    const lookup = {};
    for (const m of maps) {
        if (m.name)
            lookup[(0, localize_1.localizeField)(m.name)] = m._id.toString();
        if (m.country)
            lookup[m.country] = m._id.toString();
    }
    return lookup;
};
exports.buildCountryToMapIdLookup = buildCountryToMapIdLookup;
/** Resolve the map id that gates an offer (place.map or business country → map). */
const resolveOfferMapId = (offer, countryLookup = {}) => {
    var _a, _b, _c;
    const direct = (0, exports.getDirectOfferMapId)(offer);
    if (direct)
        return direct;
    const country = (((_b = (_a = offer === null || offer === void 0 ? void 0 : offer.business) === null || _a === void 0 ? void 0 : _a.location) === null || _b === void 0 ? void 0 : _b.country) ||
        ((_c = offer === null || offer === void 0 ? void 0 : offer.business) === null || _c === void 0 ? void 0 : _c.country) ||
        '').trim();
    if (country && countryLookup[country])
        return countryLookup[country];
    return null;
};
exports.resolveOfferMapId = resolveOfferMapId;
const resolveOfferMapIdAsync = async (offer) => {
    var _a, _b, _c;
    const direct = (0, exports.getDirectOfferMapId)(offer);
    if (direct)
        return direct;
    const country = (((_b = (_a = offer === null || offer === void 0 ? void 0 : offer.business) === null || _a === void 0 ? void 0 : _a.location) === null || _b === void 0 ? void 0 : _b.country) ||
        ((_c = offer === null || offer === void 0 ? void 0 : offer.business) === null || _c === void 0 ? void 0 : _c.country) ||
        '').trim();
    if (!country)
        return null;
    const lookup = await (0, exports.buildCountryToMapIdLookup)([country]);
    return lookup[country] || null;
};
exports.resolveOfferMapIdAsync = resolveOfferMapIdAsync;
