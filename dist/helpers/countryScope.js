"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCountryScope = void 0;
const map_model_1 = require("../modules/map/map.model");
/** Match canonical countries and translated map labels used by older records. */
const getCountryScope = async (country) => {
    var _a, _b;
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = new RegExp(`^${escape(country.trim())}$`, 'i');
    const maps = await map_model_1.Map.find({ $or: [{ country: exact }, { name: exact }, { 'name.en': exact }, { 'name.es': exact }] })
        .select('_id country name').lean();
    const names = new Set([country.trim()]);
    for (const map of maps) {
        for (const name of [map.country, typeof map.name === 'string' ? map.name : '', (_a = map.name) === null || _a === void 0 ? void 0 : _a.en, (_b = map.name) === null || _b === void 0 ? void 0 : _b.es]) {
            if (typeof name === 'string' && name.trim())
                names.add(name.trim());
        }
    }
    return { mapIds: maps.map(map => map._id), countries: [...names].map(name => new RegExp(`^${escape(name)}$`, 'i')) };
};
exports.getCountryScope = getCountryScope;
