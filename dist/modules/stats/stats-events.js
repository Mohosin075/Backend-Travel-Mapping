"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyStatsUpdated = void 0;
let timer;
/** Coalesce heartbeat/view bursts so administrators do not refetch on every write. */
const notifyStatsUpdated = (io) => {
    if (!io || timer)
        return;
    timer = setTimeout(() => {
        timer = undefined;
        io.emit('stats-updated');
    }, 1000);
};
exports.notifyStatsUpdated = notifyStatsUpdated;
