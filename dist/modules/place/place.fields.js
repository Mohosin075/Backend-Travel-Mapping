"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inactivePlaceFields = void 0;
exports.scopePlaceFields = scopePlaceFields;
const inactivePlaceFields = (type) => type === 'Business'
    ? ['schedules', 'entryCost', 'difficulty', 'hikeTime']
    : ['operatingHours', 'phone', 'website', 'instagram', 'menuImages'];
exports.inactivePlaceFields = inactivePlaceFields;
function scopePlaceFields(payload, type) {
    const scoped = { ...payload };
    for (const key of (0, exports.inactivePlaceFields)(type))
        delete scoped[key];
    return scoped;
}
