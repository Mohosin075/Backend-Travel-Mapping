"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeLocationNotification = sanitizeLocationNotification;
/** Broadcasts have no recipient context: always use generic location text. */
function sanitizeLocationNotification(value, accessibleMapIds = [], privileged = false) {
    var _a, _b;
    if (!value || value.type !== 'NEW_LOCATION')
        return value;
    const notification = typeof value.toObject === 'function' ? value.toObject() : value;
    const map = ((_a = notification.metadata) === null || _a === void 0 ? void 0 : _a.mapId) || ((_b = notification.metadata) === null || _b === void 0 ? void 0 : _b.map);
    const mapId = map && String(map._id || map.id || map);
    if (privileged || (mapId && accessibleMapIds.includes(mapId))) {
        return {
            ...notification,
            metadata: { ...notification.metadata, canRevealPlace: true },
        };
    }
    return {
        ...notification,
        title: { en: 'New place added', es: 'Nuevo lugar añadido' },
        content: {
            en: 'A new place has been added to explore.',
            es: 'Se ha añadido un nuevo lugar para explorar.',
        },
        actionText: { en: 'View maps', es: 'Ver mapas' },
        actionUrl: '/maps',
        metadata: { ...(mapId ? { mapId } : {}), canRevealPlace: false },
    };
}
