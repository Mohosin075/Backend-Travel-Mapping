"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaceService = void 0;
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const place_model_1 = require("./place.model");
const map_model_1 = require("../map/map.model");
const mongoose_1 = __importDefault(require("mongoose"));
const reverseGeocoding_1 = require("../../utils/reverseGeocoding");
const business_model_1 = require("../business/business.model");
const autoTranslate_1 = require("../../utils/autoTranslate");
const notification_integration_1 = require("../notification/notification.integration");
const visited_model_1 = require("../visited/visited.model");
const user_model_1 = require("../user/user.model");
const user_1 = require("../../enum/user");
const levelConfig_service_1 = require("../award/levelConfig.service");
const notification_service_1 = require("../notification/notification.service");
const notification_interface_1 = require("../notification/notification.interface");
const paginationHelper_1 = require("../../helpers/paginationHelper");
const resolveTranslatableField = async (newVal, existingVal) => {
    if (newVal === undefined || newVal === null)
        return newVal;
    // If existingVal already has translations { en, es }
    if (existingVal && typeof existingVal === 'object') {
        const exEn = typeof existingVal.en === 'string' ? existingVal.en.trim() : '';
        const exEs = typeof existingVal.es === 'string' ? existingVal.es.trim() : '';
        // If newVal is a string matching either the existing English or Spanish text,
        // the user did not change the meaning — keep the existing translations without API calls!
        if (typeof newVal === 'string') {
            const cleanNew = newVal.trim();
            if (cleanNew && (cleanNew === exEn || cleanNew === exEs)) {
                return { en: exEn, es: exEs };
            }
        }
        else if (typeof newVal === 'object') {
            const newEn = typeof newVal.en === 'string' ? newVal.en.trim() : '';
            const newEs = typeof newVal.es === 'string' ? newVal.es.trim() : '';
            if (newEn && newEs && newEn === exEn && newEs === exEs) {
                return { en: exEn, es: exEs };
            }
        }
    }
    // If newVal already has non-empty en and es values
    if (typeof newVal === 'object' &&
        newVal !== null &&
        newVal.en &&
        newVal.es) {
        return { en: String(newVal.en).trim(), es: String(newVal.es).trim() };
    }
    return await (0, autoTranslate_1.autoTranslateField)(newVal);
};
const processPlaceTranslations = async (payload, existingDoc) => {
    var _a, _b;
    const tasks = [];
    if (payload.name) {
        tasks.push((async () => {
            var _a, _b;
            if (typeof payload.name === 'string') {
                const trimmed = payload.name.trim();
                payload.name = { en: trimmed, es: trimmed };
            }
            else if (typeof payload.name === 'object' && payload.name !== null) {
                const enVal = (payload.name.en || '').trim();
                const esVal = (payload.name.es || '').trim();
                if (enVal && esVal) {
                    payload.name = { en: enVal, es: esVal };
                }
                else {
                    const fallback = enVal ||
                        esVal ||
                        (typeof (existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.name) === 'string'
                            ? existingDoc.name
                            : ((_a = existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.name) === null || _a === void 0 ? void 0 : _a.en) || ((_b = existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.name) === null || _b === void 0 ? void 0 : _b.es) || '');
                    payload.name = { en: enVal || fallback, es: esVal || fallback };
                }
            }
        })());
    }
    if (payload.description) {
        tasks.push((async () => {
            payload.description = await resolveTranslatableField(payload.description, existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.description);
        })());
    }
    if (payload.access) {
        tasks.push((async () => {
            payload.access = await resolveTranslatableField(payload.access, existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.access);
        })());
    }
    if (payload.entryCost) {
        tasks.push((async () => {
            payload.entryCost = await resolveTranslatableField(payload.entryCost, existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.entryCost);
        })());
    }
    if (payload.difficulty) {
        tasks.push((async () => {
            payload.difficulty = await resolveTranslatableField(payload.difficulty, existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.difficulty);
        })());
    }
    if (payload.hikeTime) {
        tasks.push((async () => {
            payload.hikeTime = await resolveTranslatableField(payload.hikeTime, existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.hikeTime);
        })());
    }
    if (payload.atmosphere) {
        tasks.push((async () => {
            payload.atmosphere = await resolveTranslatableField(payload.atmosphere, existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.atmosphere);
        })());
    }
    if ((_a = payload.accessibility) === null || _a === void 0 ? void 0 : _a.notes) {
        tasks.push((async () => {
            var _a;
            payload.accessibility.notes = await resolveTranslatableField(payload.accessibility.notes, (_a = existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.accessibility) === null || _a === void 0 ? void 0 : _a.notes);
        })());
    }
    if ((_b = payload.recommendations) === null || _b === void 0 ? void 0 : _b.tips) {
        tasks.push((async () => {
            var _a;
            payload.recommendations.tips = await resolveTranslatableField(payload.recommendations.tips, (_a = existingDoc === null || existingDoc === void 0 ? void 0 : existingDoc.recommendations) === null || _a === void 0 ? void 0 : _a.tips);
        })());
    }
    await Promise.all(tasks);
};
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function buildAccentInsensitivePattern(term) {
    if (!term)
        return '';
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped
        .replace(/\s+/g, '\\s+')
        .replace(/[aáàâäãåAÁÀÂÄÃÅ]/g, '[aáàâäãåAÁÀÂÄÃÅ]')
        .replace(/[eéèêëEÉÈÊË]/g, '[eéèêëEÉÈÊË]')
        .replace(/[iíìîïIÍÌÎÏ]/g, '[iíìîïIÍÌÎÏ]')
        .replace(/[oóòôöõOÓÒÔÖÕ]/g, '[oóòôöõOÓÒÔÖÕ]')
        .replace(/[uúüùûUÚÜÙÛ]/g, '[uúüùûUÚÜÙÛ]')
        .replace(/[nñNÑ]/g, '[nñNÑ]');
}
const toNumber = (value) => {
    const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : NaN;
};
const createPlace = async (payload) => {
    var _a;
    await processPlaceTranslations(payload);
    // 1. Resolve map and align country to designated map (prevents incorrect country when adding places)
    let map = null;
    if (payload.map) {
        map = await map_model_1.Map.findById(payload.map);
        if (!map) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
        }
        const mapCountry = map.country ||
            (typeof map.name === 'object' && map.name !== null
                ? map.name.en || map.name.es || Object.values(map.name)[0]
                : map.name);
        if (mapCountry) {
            payload.country = String(mapCountry).trim();
        }
    }
    // 2. Fallback to reverse geocoding only if country is still completely missing
    if (!payload.country && ((_a = payload.location) === null || _a === void 0 ? void 0 : _a.coordinates)) {
        const [lng, lat] = payload.location.coordinates;
        const country = await (0, reverseGeocoding_1.getCountryFromCoordinates)(lat, lng);
        if (country) {
            payload.country = country;
        }
        else {
            payload.country = 'Roadtripeado';
        }
    }
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        // Ensure map exists within session
        const mapInSession = await map_model_1.Map.findById(payload.map).session(session);
        if (!mapInSession) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
        }
        const result = await place_model_1.Place.create([payload], { session });
        const createdPlace = result[0];
        // Add place to map (do not overwrite map.country if map already has a country)
        await map_model_1.Map.findByIdAndUpdate(payload.map, {
            $push: { places: createdPlace._id },
            ...(mapInSession.country ? {} : { $set: { country: createdPlace.country } })
        }, { session });
        await session.commitTransaction();
        if (createdPlace.status === 'Published') {
            notification_integration_1.NotificationIntegration.onNewLocation(createdPlace).catch(err => console.error('Failed to notify new location:', err));
        }
        return createdPlace;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
};
const commonSearchSynonyms = {
    faro: ['lighthouse', 'faros', 'lighthouses'],
    faros: ['lighthouse', 'lighthouses', 'faro'],
    lighthouse: ['faro', 'faros', 'lighthouses'],
    lighthouses: ['faro', 'faros', 'lighthouse'],
    playa: ['beach', 'playas', 'beaches'],
    playas: ['beach', 'beaches', 'playa'],
    beach: ['playa', 'playas', 'beaches'],
    beaches: ['playa', 'playas', 'beach'],
    ruinas: ['ruins', 'ruina', 'ruin'],
    ruins: ['ruinas', 'ruina', 'ruin'],
    cascada: ['waterfall', 'cascadas', 'waterfalls'],
    waterfall: ['cascada', 'cascadas', 'waterfalls'],
    cueva: ['cave', 'cuevas', 'caves'],
    cave: ['cueva', 'cuevas', 'caves'],
    castillo: ['castle', 'castillos', 'castles', 'fort', 'fortress'],
    castillos: ['castillo', 'castle', 'castles'],
    castle: ['castillo', 'castillos', 'castles', 'fort'],
    castles: ['castillo', 'castle', 'castillos'],
    tunel: ['tunnel', 'tuneles', 'tunnels'],
    tunnel: ['tunel', 'tunnels', 'tuneles'],
    puente: ['bridge', 'puentes', 'bridges'],
    bridge: ['puente', 'bridges', 'puentes'],
    rio: ['river', 'rios', 'rivers'],
    river: ['rio', 'rivers', 'rios'],
    charco: ['pond', 'pool', 'charcos'],
    mirador: ['viewpoint', 'lookout', 'miradores'],
    viewpoint: ['mirador', 'miradores'],
    bosque: ['forest', 'bosques', 'forests'],
    forest: ['bosque', 'forests', 'bosques'],
    isla: ['island', 'islas', 'islands'],
    island: ['isla', 'islands', 'islas'],
    bahia: ['bay', 'bahias', 'bays'],
    bay: ['bahia', 'bays', 'bahias'],
    laguna: ['lagoon', 'lagunas', 'lagoons'],
    lagoon: ['laguna', 'lagoons', 'lagunas'],
    museo: ['museum', 'museos', 'museums'],
    museum: ['museo', 'museums', 'museos'],
    restaurante: ['restaurant', 'restaurantes', 'restaurants'],
    restaurant: ['restaurante', 'restaurants', 'restaurantes'],
    hotel: ['hotel', 'hoteles', 'hotels'],
    hotels: ['hotel', 'hoteles'],
};
function buildPlaceSearchFilter(searchTerm, isBusiness = false) {
    const clean = searchTerm
        .trim()
        .toLowerCase()
        .replace(/[,;:.!?]/g, ' ')
        .replace(/\s+/g, ' ');
    if (!clean)
        return null;
    const stopWords = [
        'los',
        'las',
        'del',
        'the',
        'and',
        'con',
        'para',
        'de',
        'en',
        'el',
        'la',
        'pr',
        'puerto',
        'rico',
    ];
    const words = clean
        .split(/\s+/)
        .filter(w => w.length > 1 && !stopWords.includes(w));
    const phraseRegex = new RegExp(buildAccentInsensitivePattern(clean), 'i');
    const getFields = (regex) => {
        if (isBusiness) {
            return [
                { name: regex },
                { 'name.en': regex },
                { 'name.es': regex },
                { 'location.address': regex },
                { 'location.address.en': regex },
                { 'location.address.es': regex },
                { 'location.city': regex },
            ];
        }
        return [
            { name: regex },
            { 'name.en': regex },
            { 'name.es': regex },
            { address: regex },
            { 'address.en': regex },
            { 'address.es': regex },
            { 'location.city': regex },
            { 'location.address': regex },
        ];
    };
    // Single word: match term or synonyms
    if (words.length <= 1) {
        const termToUse = words[0] || clean;
        const terms = [termToUse];
        if (commonSearchSynonyms[termToUse]) {
            terms.push(...commonSearchSynonyms[termToUse]);
        }
        const singleRegex = new RegExp(terms.map(t => buildAccentInsensitivePattern(t)).join('|'), 'i');
        return { $or: getFields(singleRegex) };
    }
    // Multi-word search (e.g. "San Sebastian", "Cabo Rojo", "Cascada Gozalandia"):
    // Either exact phrase in any field, OR each significant word must be found across the place's fields
    const wordAndConditions = words.map(w => {
        const wRegex = new RegExp(buildAccentInsensitivePattern(w), 'i');
        return { $or: getFields(wRegex) };
    });
    return {
        $or: [
            { $or: getFields(phraseRegex) },
            { $and: wordAndConditions },
        ],
    };
}
const getAllPlaces = async (query, isAdminOrEditor = false, accessibleMapIds = []) => {
    const searchTerm = typeof query.searchTerm === 'string' ? query.searchTerm.trim() : '';
    const lat = toNumber(query.lat);
    const lng = toNumber(query.lng);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
    const sort = typeof query.sort === 'string' && query.sort.trim()
        ? query.sort.trim()
        : '-createdAt';
    const limit = Number(query.limit) || 10;
    const page = Number(query.page) || 1;
    const skip = (page - 1) * limit;
    const match = {};
    for (const key of ['map', 'country', 'category', 'type']) {
        const value = query[key];
        if (typeof value === 'string' && value.trim() && value !== 'undefined') {
            match[key] = value.includes(',') ? { $in: value.split(',') } : value;
        }
    }
    // Handle status filter: non-admins only ever see Published places
    if (!isAdminOrEditor) {
        match.status = 'Published';
    }
    else if (typeof query.status === 'string' &&
        query.status.trim() &&
        query.status !== 'undefined' &&
        query.status !== 'all') {
        match.status = query.status.includes(',')
            ? { $in: query.status.split(',') }
            : query.status;
    }
    else if (typeof query.excludeStatus === 'string' &&
        query.excludeStatus.trim()) {
        const excluded = query.excludeStatus.trim().split(',').map(s => s.trim());
        match.status = excluded.length > 1 ? { $nin: excluded } : { $ne: excluded[0] };
    }
    if (searchTerm) {
        const searchFilter = buildPlaceSearchFilter(searchTerm, false);
        if (searchFilter) {
            Object.assign(match, searchFilter);
        }
    }
    // Apply access before deduplication and pagination so locked search hits cannot
    // reveal names or displace accessible results. Unfiltered map teasers are unchanged.
    if (searchTerm && !isAdminOrEditor) {
        match.$and = [{ map: { $in: accessibleMapIds } }];
    }
    // 1. Fetch regular places if applicable
    const queryType = query.type;
    const shouldQueryPlaces = !queryType || queryType === 'Regular' || queryType.includes('Regular');
    let places = [];
    if (shouldQueryPlaces) {
        let placeQuery = place_model_1.Place.find(hasGeo
            ? {
                ...match,
                location: {
                    $nearSphere: {
                        $geometry: { type: 'Point', coordinates: [lng, lat] },
                    },
                },
            }
            : match)
            .populate('category', 'name color icon status')
            .populate('map', 'name country status isPaid')
            .populate('discoveredBy', 'name profile level')
            .lean();
        if (!hasGeo) {
            placeQuery = placeQuery.sort(sort);
        }
        places = await placeQuery;
    }
    const formattedPlaces = places.map(p => ({
        ...p,
        _id: p._id.toString(),
    }));
    // 2. Fetch businesses if applicable
    const shouldQueryBusinesses = !queryType || queryType === 'Business' || queryType.includes('Business');
    let formattedBusinesses = [];
    if (shouldQueryBusinesses) {
        const businessMatch = {};
        if (match.category) {
            businessMatch.category = match.category;
        }
        if (match.country) {
            businessMatch['location.country'] = match.country;
        }
        else if (match.map) {
            if (typeof match.map === 'object' && match.map !== null && '$in' in match.map) {
                const mapObjs = await map_model_1.Map.find({ _id: match.map }).select('name country').lean();
                businessMatch['location.country'] = { $in: mapObjs.map(m => m.country || m.name) };
            }
            else {
                const mapObj = await map_model_1.Map.findById(match.map).select('name country').lean();
                if (mapObj) {
                    businessMatch['location.country'] = mapObj.country || mapObj.name;
                }
            }
        }
        if (match.status) {
            if (typeof match.status === 'object' && match.status !== null && '$in' in match.status) {
                const statusObj = match.status;
                const statuses = statusObj.$in.map((s) => {
                    if (s === 'Published')
                        return 'Approved';
                    if (s === 'Draft')
                        return 'Pending';
                    return s;
                });
                businessMatch.status = { $in: statuses };
            }
            else {
                const statusStr = match.status;
                if (statusStr === 'Published') {
                    businessMatch.status = 'Approved';
                }
                else if (statusStr === 'Draft') {
                    businessMatch.status = 'Pending';
                }
                else {
                    businessMatch.status = statusStr;
                }
            }
        }
        if (searchTerm) {
            const searchFilter = buildPlaceSearchFilter(searchTerm, true);
            if (searchFilter) {
                Object.assign(businessMatch, searchFilter);
            }
        }
        let businessQuery = business_model_1.Business.find(hasGeo
            ? {
                ...businessMatch,
                'location.mapLocation': {
                    $nearSphere: {
                        $geometry: { type: 'Point', coordinates: [lng, lat] },
                    },
                },
            }
            : businessMatch)
            .populate('category', 'name color icon status')
            .lean();
        if (!hasGeo) {
            businessQuery = businessQuery.sort(sort);
        }
        const businesses = await businessQuery;
        formattedBusinesses = businesses.map(business => {
            var _a, _b, _c, _d, _e, _f, _g;
            let placeStatus = 'Draft';
            if (business.status === 'Approved')
                placeStatus = 'Published';
            else if (business.status === 'Pending')
                placeStatus = 'Draft';
            else
                placeStatus = business.status;
            return {
                ...business,
                _id: business._id.toString(),
                type: 'Business',
                placeType: 'Business',
                status: placeStatus,
                media: ((_a = business.media) === null || _a === void 0 ? void 0 : _a.photos) || [],
                menuImages: ((_b = business.media) === null || _b === void 0 ? void 0 : _b.menu) ? [business.media.menu] : [],
                address: ((_c = business.location) === null || _c === void 0 ? void 0 : _c.address) || '',
                country: ((_d = business.location) === null || _d === void 0 ? void 0 : _d.country) || '',
                location: {
                    type: 'Point',
                    coordinates: ((_f = (_e = business.location) === null || _e === void 0 ? void 0 : _e.mapLocation) === null || _f === void 0 ? void 0 : _f.coordinates) || [],
                },
                map: { name: (_g = business.location) === null || _g === void 0 ? void 0 : _g.country },
            };
        });
    }
    // 3. Deduplicate and combine results (Issue 6: Prevent duplicate location records like Bai Picnic)
    const getAllNormalizedNames = (item) => {
        const names = [];
        const norm = (s) => String(s || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
        if (typeof (item === null || item === void 0 ? void 0 : item.name) === 'string') {
            names.push(norm(item.name));
        }
        else if ((item === null || item === void 0 ? void 0 : item.name) && typeof item.name === 'object') {
            if (item.name.en)
                names.push(norm(item.name.en));
            if (item.name.es)
                names.push(norm(item.name.es));
            for (const val of Object.values(item.name)) {
                if (typeof val === 'string')
                    names.push(norm(val));
            }
        }
        return Array.from(new Set(names.filter(Boolean)));
    };
    const getCoordsKey = (item) => {
        var _a, _b, _c;
        const coords = ((_a = item === null || item === void 0 ? void 0 : item.location) === null || _a === void 0 ? void 0 : _a.coordinates) ||
            ((_c = (_b = item === null || item === void 0 ? void 0 : item.location) === null || _b === void 0 ? void 0 : _b.mapLocation) === null || _c === void 0 ? void 0 : _c.coordinates) ||
            (item === null || item === void 0 ? void 0 : item.coordinates);
        if (Array.isArray(coords) && coords.length >= 2) {
            const lng = Number(coords[0]);
            const lat = Number(coords[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                return `${lng.toFixed(4)},${lat.toFixed(4)}`;
            }
        }
        return null;
    };
    const businessNameSet = new Set();
    const businessCoordSet = new Set();
    const deduplicatedBusinesses = [];
    for (const b of formattedBusinesses) {
        const bNames = getAllNormalizedNames(b);
        const coordKey = getCoordsKey(b);
        if (bNames.some(n => businessNameSet.has(n)))
            continue;
        if (coordKey && businessCoordSet.has(coordKey) && bNames.length > 0)
            continue;
        bNames.forEach(n => businessNameSet.add(n));
        if (coordKey)
            businessCoordSet.add(coordKey);
        deduplicatedBusinesses.push(b);
    }
    const placeNameSet = new Set();
    const placeCoordSet = new Set();
    const deduplicatedPlaces = [];
    for (const p of formattedPlaces) {
        const pNames = getAllNormalizedNames(p);
        const coordKey = getCoordsKey(p);
        // Check if this place matches an existing registered Business (by name or coords + similarity)
        const matchesBusinessByName = pNames.some(n => businessNameSet.has(n));
        const matchesBusinessByCoord = Boolean(coordKey &&
            businessCoordSet.has(coordKey) &&
            deduplicatedBusinesses.some(b => {
                const bNames = getAllNormalizedNames(b);
                return bNames.some(bn => pNames.some(pn => pn.includes(bn) || bn.includes(pn)));
            }));
        if (matchesBusinessByName || matchesBusinessByCoord) {
            const matchingBusiness = deduplicatedBusinesses.find(b => {
                const bNames = getAllNormalizedNames(b);
                return (bNames.some(bn => pNames.includes(bn)) ||
                    (coordKey && getCoordsKey(b) === coordKey));
            });
            if (matchingBusiness) {
                if (!matchingBusiness.category && p.category)
                    matchingBusiness.category = p.category;
                if (!matchingBusiness.map && p.map)
                    matchingBusiness.map = p.map;
            }
            continue;
        }
        if (pNames.some(n => placeNameSet.has(n)))
            continue;
        if (coordKey && placeCoordSet.has(coordKey) && pNames.length > 0)
            continue;
        pNames.forEach(n => placeNameSet.add(n));
        if (coordKey)
            placeCoordSet.add(coordKey);
        deduplicatedPlaces.push(p);
    }
    let combined = [...deduplicatedPlaces, ...deduplicatedBusinesses];
    // Filter and sort combined results
    if (searchTerm) {
        const stripAccents = (str) => (str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[,;:.!?]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const cleanSearch = stripAccents(searchTerm);
        const stopWords = [
            'los',
            'las',
            'del',
            'the',
            'and',
            'con',
            'para',
            'de',
            'en',
            'el',
            'la',
            'pr',
            'puerto',
            'rico',
        ];
        const wordsClean = cleanSearch
            .split(/\s+/)
            .filter(w => w.length > 1 && !stopWords.includes(w));
        const mainPhrase = wordsClean.join(' ');
        const getScore = (p) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            let score = 0;
            const nameEn = stripAccents(((_a = p.name) === null || _a === void 0 ? void 0 : _a.en) || (typeof p.name === 'string' ? p.name : ''));
            const nameEs = stripAccents(((_b = p.name) === null || _b === void 0 ? void 0 : _b.es) || (typeof p.name === 'string' ? p.name : ''));
            const addrEn = stripAccents(((_c = p.address) === null || _c === void 0 ? void 0 : _c.en) || p.address || ((_d = p.location) === null || _d === void 0 ? void 0 : _d.address) || ((_e = p.location) === null || _e === void 0 ? void 0 : _e.city) || '');
            const addrEs = stripAccents(((_f = p.address) === null || _f === void 0 ? void 0 : _f.es) || p.address || ((_g = p.location) === null || _g === void 0 ? void 0 : _g.address) || ((_h = p.location) === null || _h === void 0 ? void 0 : _h.city) || '');
            const nameText = `${nameEn} ${nameEs}`.trim();
            const addrText = `${addrEn} ${addrEs}`.trim();
            const fullText = `${nameText} ${addrText}`.trim();
            // Exact phrase match
            if (nameText.startsWith(cleanSearch) ||
                (mainPhrase && nameText.startsWith(mainPhrase))) {
                score += 1000;
            }
            else if (nameText.includes(cleanSearch) ||
                (mainPhrase && nameText.includes(mainPhrase))) {
                score += 800;
            }
            if (addrText.startsWith(cleanSearch) ||
                (mainPhrase && addrText.startsWith(mainPhrase))) {
                score += 600;
            }
            else if (addrText.includes(cleanSearch) ||
                (mainPhrase && addrText.includes(mainPhrase))) {
                score += 500;
            }
            // Multi-word search (e.g. "San Sebastian", "Cascada Gozalandia")
            if (wordsClean.length > 1) {
                if (score === 0) {
                    const allWordsPresent = wordsClean.every(w => fullText.includes(w));
                    if (allWordsPresent) {
                        score += 350;
                    }
                }
            }
            else if (wordsClean.length === 1) {
                const single = wordsClean[0];
                if (score === 0) {
                    if (nameText.startsWith(single))
                        score += 450;
                    else if (nameText.includes(single))
                        score += 400;
                    else if (addrText.startsWith(single))
                        score += 350;
                    else if (addrText.includes(single))
                        score += 300;
                    else {
                        const syns = commonSearchSynonyms[single] || [];
                        for (const s of syns) {
                            if (nameText.includes(s) || addrText.includes(s)) {
                                score += 200;
                                break;
                            }
                        }
                    }
                }
            }
            return score;
        };
        // Filter out places with 0 score (strictly keep actual matches only)
        combined = combined.filter((p) => getScore(p) > 0);
        if (!hasGeo) {
            combined.sort((a, b) => {
                const scoreDiff = getScore(b) - getScore(a);
                if (scoreDiff !== 0)
                    return scoreDiff;
                return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
            });
        }
    }
    else if (!hasGeo) {
        const isDesc = sort.startsWith('-');
        const sortField = sort.replace('-', '');
        combined.sort((a, b) => {
            var _a, _b, _c, _d;
            let valA = a[sortField];
            let valB = b[sortField];
            if (sortField === 'map') {
                valA = ((_a = a.map) === null || _a === void 0 ? void 0 : _a.name) || '';
                valB = ((_b = b.map) === null || _b === void 0 ? void 0 : _b.name) || '';
            }
            else if (sortField === 'category') {
                valA = ((_c = a.category) === null || _c === void 0 ? void 0 : _c.name) || '';
                valB = ((_d = b.category) === null || _d === void 0 ? void 0 : _d.name) || '';
            }
            else if (sortField === 'createdAt' || sortField === 'updatedAt') {
                valA = valA ? new Date(valA).getTime() : 0;
                valB = valB ? new Date(valB).getTime() : 0;
            }
            if (typeof valA === 'string')
                valA = valA.toLowerCase();
            if (typeof valB === 'string')
                valB = valB.toLowerCase();
            if (valA < valB)
                return isDesc ? 1 : -1;
            if (valA > valB)
                return isDesc ? -1 : 1;
            return 0;
        });
    }
    const total = combined.length;
    const paginatedData = combined.slice(skip, skip + limit);
    return {
        meta: {
            total,
            page,
            limit,
            totalPage: Math.ceil(total / limit) || 0,
        },
        data: paginatedData,
    };
};
const getPlaceById = async (id) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const result = await place_model_1.Place.findById(id)
        .populate('category')
        .populate('map')
        .populate('discoveredBy', 'name profile level')
        .lean();
    if (result)
        return result;
    // Fallback to checking Business collection
    const business = await business_model_1.Business.findById(id).populate('category').lean();
    if (business) {
        let placeStatus = 'Draft';
        if (business.status === 'Approved')
            placeStatus = 'Published';
        else if (business.status === 'Pending')
            placeStatus = 'Draft';
        else
            placeStatus = business.status;
        // Map Business fields to Place schema so frontend doesn't break
        return {
            ...business,
            _id: business._id.toString(),
            type: 'Business',
            placeType: 'Business',
            status: placeStatus,
            media: (((_a = business.media) === null || _a === void 0 ? void 0 : _a.photos) || []).filter(Boolean),
            menuImages: ((_b = business.media) === null || _b === void 0 ? void 0 : _b.menu) ? [business.media.menu] : [],
            address: ((_c = business.location) === null || _c === void 0 ? void 0 : _c.address) || '',
            country: ((_d = business.location) === null || _d === void 0 ? void 0 : _d.country) || '',
            location: {
                type: 'Point',
                coordinates: ((_f = (_e = business.location) === null || _e === void 0 ? void 0 : _e.mapLocation) === null || _f === void 0 ? void 0 : _f.coordinates) || [],
            },
            map: { name: (_g = business.location) === null || _g === void 0 ? void 0 : _g.country },
            // Expose hours.schedule as operatingHours so edit form loads the saved data
            operatingHours: ((_h = business.hours) === null || _h === void 0 ? void 0 : _h.schedule) || null,
            phone: ((_j = business.contact) === null || _j === void 0 ? void 0 : _j.phone) || '',
            website: ((_k = business.contact) === null || _k === void 0 ? void 0 : _k.website) || '',
            instagram: ((_l = business.contact) === null || _l === void 0 ? void 0 : _l.instagram) || '',
        };
    }
    throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
};
const incrementOpenCount = async (id) => {
    const result = await place_model_1.Place.findByIdAndUpdate(id, { $inc: { openCount: 1 } }, { new: true }).select('name openCount');
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
    }
    return result;
};
const updatePlace = async (id, payload) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const isExist = await place_model_1.Place.findById(id);
    if (!isExist) {
        // Fallback: Check and update Business collection
        const isBusiness = await business_model_1.Business.findById(id);
        if (!isBusiness) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
        }
        await processPlaceTranslations(payload, isBusiness);
        // Map payload from Place structure back to Business schema format
        const businessPayload = {};
        if (payload.name)
            businessPayload.name = payload.name;
        if (payload.category)
            businessPayload.category = payload.category;
        if (payload.description)
            businessPayload.description = payload.description;
        // Address & coordinates mapping
        if (payload.address || ((_a = payload.location) === null || _a === void 0 ? void 0 : _a.coordinates)) {
            businessPayload.location = {
                ...(isBusiness.location || {}),
                ...(payload.address && { address: payload.address }),
                ...(((_b = payload.location) === null || _b === void 0 ? void 0 : _b.coordinates) && {
                    mapLocation: {
                        type: 'Point',
                        coordinates: payload.location.coordinates,
                    },
                }),
            };
        }
        // Media mapping
        if (payload.media) {
            businessPayload.media = {
                ...(isBusiness.media || {}),
                photos: payload.media,
            };
        }
        if (payload.menuImages && payload.menuImages.length > 0) {
            businessPayload.media = {
                ...(businessPayload.media || isBusiness.media || {}),
                menu: payload.menuImages[0], // Business schema holds a single string for menu
            };
        }
        // Phone, website, instagram
        if (payload.phone || payload.website || payload.instagram) {
            businessPayload.contact = {
                ...(isBusiness.contact || {}),
                ...(payload.phone && { phone: payload.phone }),
                ...(payload.website && { website: payload.website }),
                ...(payload.instagram && { instagram: payload.instagram }),
            };
        }
        // Hours / Schedule — support full operatingHours object { Monday: { open, close, closed } }
        if (payload.operatingHours && typeof payload.operatingHours === 'object') {
            // Merge with existing hours so we don't wipe unrelated fields
            businessPayload['hours.customHours'] = true;
            businessPayload['hours.schedule'] = payload.operatingHours;
        }
        // Status mapping for business
        if (payload.status) {
            if (payload.status === 'Published')
                businessPayload.status = 'Approved';
            else if (payload.status === 'Draft')
                businessPayload.status = 'Pending';
            else
                businessPayload.status = payload.status;
        }
        const updatedBusiness = await business_model_1.Business.findByIdAndUpdate(id, businessPayload, {
            new: true,
            runValidators: true,
        }).populate('category');
        // Return mapped to Place schema format
        if (updatedBusiness) {
            let placeStatus = 'Draft';
            if (updatedBusiness.status === 'Approved')
                placeStatus = 'Published';
            else if (updatedBusiness.status === 'Pending')
                placeStatus = 'Draft';
            else
                placeStatus = updatedBusiness.status;
            return {
                ...updatedBusiness.toObject(),
                type: 'Business',
                placeType: 'Business',
                status: placeStatus,
                media: (((_c = updatedBusiness.media) === null || _c === void 0 ? void 0 : _c.photos) || []).filter(Boolean),
                menuImages: ((_d = updatedBusiness.media) === null || _d === void 0 ? void 0 : _d.menu) ? [updatedBusiness.media.menu] : [],
                address: ((_e = updatedBusiness.location) === null || _e === void 0 ? void 0 : _e.address) || '',
                country: ((_f = updatedBusiness.location) === null || _f === void 0 ? void 0 : _f.country) || '',
                location: {
                    type: 'Point',
                    coordinates: ((_h = (_g = updatedBusiness.location) === null || _g === void 0 ? void 0 : _g.mapLocation) === null || _h === void 0 ? void 0 : _h.coordinates) || [],
                },
                map: { name: (_j = updatedBusiness.location) === null || _j === void 0 ? void 0 : _j.country },
            };
        }
        return null;
    }
    await processPlaceTranslations(payload, isExist);
    const nextCoords = (_k = payload.location) === null || _k === void 0 ? void 0 : _k.coordinates;
    const prevCoords = (_l = isExist.location) === null || _l === void 0 ? void 0 : _l.coordinates;
    const COORD_EPSILON = 1e-6;
    const coordsChanged = !!nextCoords &&
        (!prevCoords ||
            Math.abs(nextCoords[0] - prevCoords[0]) > COORD_EPSILON ||
            Math.abs(nextCoords[1] - prevCoords[1]) > COORD_EPSILON);
    // Only hit Google when the pin actually moved and no map country exists
    if (coordsChanged && !payload.country) {
        const targetMapId = payload.map || isExist.map;
        if (targetMapId) {
            const targetMap = await map_model_1.Map.findById(targetMapId);
            const mapCountry = (targetMap === null || targetMap === void 0 ? void 0 : targetMap.country) ||
                (typeof (targetMap === null || targetMap === void 0 ? void 0 : targetMap.name) === 'object' && (targetMap === null || targetMap === void 0 ? void 0 : targetMap.name) !== null
                    ? targetMap.name.en || targetMap.name.es
                    : targetMap === null || targetMap === void 0 ? void 0 : targetMap.name);
            if (mapCountry) {
                payload.country = String(mapCountry).trim();
            }
        }
        if (!payload.country) {
            const [lng, lat] = nextCoords;
            const country = await (0, reverseGeocoding_1.getCountryFromCoordinates)(lat, lng);
            if (country) {
                payload.country = country;
            }
        }
    }
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        // Handle map change
        if (payload.map && payload.map.toString() !== isExist.map.toString()) {
            // Remove from old map
            await map_model_1.Map.findByIdAndUpdate(isExist.map, { $pull: { places: isExist._id } }, { session });
            // Add to new map
            await map_model_1.Map.findByIdAndUpdate(payload.map, { $push: { places: isExist._id } }, { session });
        }
        const nextMedia = Array.isArray(payload.media)
            ? payload.media.filter(Boolean)
            : undefined;
        if (nextMedia) {
            payload.media = nextMedia.length > 0 ? nextMedia : isExist.media;
        }
        const nextMenu = Array.isArray(payload.menuImages)
            ? payload.menuImages.filter(Boolean)
            : undefined;
        if (nextMenu) {
            payload.menuImages = nextMenu.length > 0 ? nextMenu : isExist.menuImages;
        }
        const result = await place_model_1.Place.findByIdAndUpdate(id, payload, {
            new: true,
            runValidators: true,
            session,
        })
            .populate('category')
            .populate('map');
        await session.commitTransaction();
        if (isExist.status !== 'Published' && result && result.status === 'Published') {
            notification_integration_1.NotificationIntegration.onNewLocation(result).catch(err => console.error('Failed to notify new location:', err));
        }
        return result;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
};
const deletePlace = async (id) => {
    const isExist = await place_model_1.Place.findById(id);
    if (!isExist) {
        const isBusiness = await business_model_1.Business.findById(id);
        if (!isBusiness) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
        }
        return await business_model_1.Business.findByIdAndDelete(id);
    }
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        const result = await place_model_1.Place.findByIdAndDelete(id).session(session);
        // Remove place from all maps
        await map_model_1.Map.updateMany({ places: new mongoose_1.default.Types.ObjectId(id) }, { $pull: { places: new mongoose_1.default.Types.ObjectId(id) } }, { session });
        // Clean up visited references
        await visited_model_1.Visited.deleteMany({ $or: [{ place: id }, { business: id }] }).session(session);
        await user_model_1.User.updateMany({ visitedPlaces: id }, { $pull: { visitedPlaces: id }, $inc: { visitedPlacesCount: -1 } }, { session });
        await session.commitTransaction();
        return result;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
};
const recommendPlace = async (user, payload) => {
    var _a;
    const privilegedRoles = [user_1.USER_ROLES.ADMIN, user_1.USER_ROLES.SUPER_ADMIN, user_1.USER_ROLES.MAP_EDITOR];
    const isPrivileged = privilegedRoles.includes(user.role);
    const userId = user.authId || user._id || user.id;
    const dbUser = await user_model_1.User.findById(userId);
    if (!dbUser) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.UNAUTHORIZED, 'User not found');
    }
    // Users must reach Level 1 (Aventurero) to recommend spots (unless admin/editor)
    if (!isPrivileged && (dbUser.level || 0) < 1) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'You must reach Level 1 (Aventurero) to recommend new tourist spots. Continue exploring and reviewing places to level up!');
    }
    // Ensure spot is submitted as Pending
    payload.status = 'Pending';
    payload.discoveredBy = dbUser._id;
    payload.discoveredByName = dbUser.name || 'Anonymous Explorer';
    payload.pointsAwarded = 0;
    payload.adminFeedback = '';
    if (!payload.description) {
        payload.description = payload.name || 'Lugar recomendado';
    }
    await processPlaceTranslations(payload);
    // 1. Resolve map and align country to designated map
    let map = null;
    if (payload.map) {
        map = await map_model_1.Map.findById(payload.map);
        if (!map) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Map not found');
        }
        const mapCountry = map.country ||
            (typeof map.name === 'object' && map.name !== null
                ? map.name.en || map.name.es || Object.values(map.name)[0]
                : map.name);
        if (mapCountry) {
            payload.country = String(mapCountry).trim();
        }
    }
    // 2. Auto-populate country if still missing
    if (!payload.country && ((_a = payload.location) === null || _a === void 0 ? void 0 : _a.coordinates)) {
        const [lng, lat] = payload.location.coordinates;
        const country = await (0, reverseGeocoding_1.getCountryFromCoordinates)(lat, lng);
        if (country) {
            payload.country = country;
        }
        else {
            payload.country = 'Roadtripeado';
        }
    }
    const createdPlace = await place_model_1.Place.create(payload);
    return createdPlace;
};
const reviewRecommendedPlace = async (id, payload) => {
    const place = await place_model_1.Place.findById(id);
    if (!place) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
    }
    if (place.status === 'Published' && payload.status === 'Published') {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Place is already published');
    }
    const session = await mongoose_1.default.startSession();
    try {
        session.startTransaction();
        const points = payload.pointsAwarded !== undefined ? payload.pointsAwarded : 25;
        const updateData = {
            status: payload.status,
            adminFeedback: payload.adminFeedback || '',
        };
        if (payload.status === 'Published') {
            updateData.pointsAwarded = points;
            updateData.isApproved = true;
        }
        const updatedPlace = await place_model_1.Place.findByIdAndUpdate(id, { $set: updateData }, { new: true, session })
            .populate('category')
            .populate('map');
        if (!updatedPlace) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Place not found');
        }
        let levelUnlockedData = null;
        // If published, link to map and award points to discoveredBy
        if (payload.status === 'Published') {
            await map_model_1.Map.findByIdAndUpdate(place.map, {
                $addToSet: { places: updatedPlace._id },
                ...(updatedPlace.country ? { $set: { country: updatedPlace.country } } : {}),
            }, { session });
            if (place.discoveredBy) {
                const contributor = await user_model_1.User.findById(place.discoveredBy).session(session);
                if (contributor) {
                    const oldLevel = contributor.level || 0;
                    const newPoints = (contributor.points || 0) + points;
                    const levelInfo = await levelConfig_service_1.LevelConfigServices.getDynamicUserLevel(newPoints, contributor.totalReviewsApproved || 0);
                    const newLevel = levelInfo.levelNumber;
                    if (newLevel > oldLevel) {
                        levelUnlockedData = {
                            newLevel,
                            levelName: levelInfo.title || `Nivel ${newLevel}`,
                            oldLevel,
                        };
                    }
                    await user_model_1.User.findByIdAndUpdate(place.discoveredBy, { $set: { points: newPoints, level: newLevel } }, { session });
                }
            }
        }
        await session.commitTransaction();
        const placeName = typeof updatedPlace.name === 'object' && updatedPlace.name !== null
            ? updatedPlace.name.es || updatedPlace.name.en || 'Lugar'
            : updatedPlace.name || 'Lugar';
        if (payload.status === 'Published') {
            if (place.discoveredBy) {
                notification_service_1.NotificationServices.createNotification({
                    userId: place.discoveredBy,
                    title: {
                        es: '¡Tu recomendación de lugar ha sido aprobada! 🌟',
                        en: 'Your recommended tourist spot has been approved! 🌟',
                    },
                    content: {
                        es: `¡Felicidades! Tu lugar "${placeName}" ha sido aprobado y publicado en el mapa. Has ganado ${points} puntos.`,
                        en: `Congratulations! Your spot "${placeName}" has been approved and published to the map. You earned ${points} points.`,
                    },
                    type: notification_interface_1.NotificationType.EARNED_REWARD,
                    category: notification_interface_1.NotificationCategory.ROADTRIPEADO,
                    priority: notification_interface_1.NotificationPriority.HIGH,
                    actionUrl: `/places/${updatedPlace._id}`,
                    actionText: {
                        es: 'Ver Lugar',
                        en: 'View Spot',
                    },
                    metadata: {
                        placeId: updatedPlace._id,
                        pointsAwarded: points,
                    },
                }).catch(err => console.error('Error sending spot approval notification:', err));
                if (levelUnlockedData) {
                    notification_integration_1.NotificationIntegration.onLevelUnlocked({
                        userId: place.discoveredBy,
                        newLevel: levelUnlockedData.newLevel,
                        levelName: levelUnlockedData.levelName,
                        oldLevel: levelUnlockedData.oldLevel,
                    }).catch(err => console.error('Error sending level unlocked notification:', err));
                }
            }
            notification_integration_1.NotificationIntegration.onNewLocation(updatedPlace).catch(err => console.error('Failed to notify new location:', err));
        }
        else if (payload.status === 'Rejected' && place.discoveredBy) {
            notification_service_1.NotificationServices.createNotification({
                userId: place.discoveredBy,
                title: {
                    es: 'Actualización sobre tu sugerencia de lugar',
                    en: 'Update on your suggested spot',
                },
                content: {
                    es: `Tu sugerencia para "${placeName}" no pudo ser aprobada en este momento.${payload.adminFeedback ? ` Motivo: ${payload.adminFeedback}` : ''}`,
                    en: `Your suggestion for "${placeName}" could not be approved at this time.${payload.adminFeedback ? ` Reason: ${payload.adminFeedback}` : ''}`,
                },
                type: notification_interface_1.NotificationType.SYSTEM_ALERT,
                category: notification_interface_1.NotificationCategory.ROADTRIPEADO,
                priority: notification_interface_1.NotificationPriority.MEDIUM,
                metadata: {
                    placeId: updatedPlace._id,
                    adminFeedback: payload.adminFeedback,
                },
            }).catch(err => console.error('Error sending spot rejection notification:', err));
        }
        return updatedPlace;
    }
    catch (error) {
        await session.abortTransaction();
        throw error;
    }
    finally {
        session.endSession();
    }
};
const getMyRecommendations = async (userId, paginationOptions, statusFilter) => {
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper_1.paginationHelper.calculatePagination(paginationOptions);
    const filter = { discoveredBy: userId };
    if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'Published' || statusFilter === 'Approved') {
            filter.$or = [
                { status: 'Published' },
                { isApproved: true },
                { pointsAwarded: { $gt: 0 } },
            ];
        }
        else if (statusFilter === 'Pending') {
            filter.status = 'Pending';
            filter.isApproved = { $ne: true };
            filter.pointsAwarded = { $lte: 0 };
        }
        else {
            filter.status = statusFilter;
        }
    }
    const [data, total] = await Promise.all([
        place_model_1.Place.find(filter)
            .populate('category')
            .populate('map', 'name country')
            .sort({ [sortBy || 'createdAt']: sortOrder || -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        place_model_1.Place.countDocuments(filter),
    ]);
    return {
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
        data,
    };
};
exports.PlaceService = {
    createPlace,
    getAllPlaces,
    getPlaceById,
    incrementOpenCount,
    updatePlace,
    deletePlace,
    recommendPlace,
    reviewRecommendedPlace,
    getMyRecommendations,
};
