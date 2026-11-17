"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockedPlaceTeaser = void 0;
/** Public marker fields only. Locked locations must not carry detail payloads. */
const lockedPlaceTeaser = (place) => {
    const source = typeof (place === null || place === void 0 ? void 0 : place.toObject) === 'function' ? place.toObject() : place;
    const teaser = {};
    for (const key of [
        '_id', 'id', 'name', 'type', 'placeType', 'status', 'country',
        'address', 'municipality', 'region', 'town', 'category', 'media',
        'rating', 'totalReview', 'createdAt', 'isNewlyAdded', 'isVisited',
    ]) {
        if ((source === null || source === void 0 ? void 0 : source[key]) !== undefined)
            teaser[key] = source[key];
    }
    if (source === null || source === void 0 ? void 0 : source.map) {
        if (typeof source.map === 'object' && !source.map._bsontype) {
            teaser.map = {};
            for (const key of ['_id', 'id', 'name', 'country', 'status', 'isPaid']) {
                if (source.map[key] !== undefined)
                    teaser.map[key] = source.map[key];
            }
        }
        else {
            teaser.map = source.map;
        }
    }
    if (source === null || source === void 0 ? void 0 : source.location) {
        teaser.location = {};
        for (const key of ['type', 'coordinates', 'address', 'city', 'state', 'country', 'municipality', 'region', 'town']) {
            if (source.location[key] !== undefined)
                teaser.location[key] = source.location[key];
        }
    }
    return { ...teaser, isLocked: true };
};
exports.lockedPlaceTeaser = lockedPlaceTeaser;
