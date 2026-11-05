import type { Server } from 'socket.io'

let timer: ReturnType<typeof setTimeout> | undefined

/** Coalesce heartbeat/view bursts so administrators do not refetch on every write. */
export const notifyStatsUpdated = (io?: Server) => {
  if (!io || timer) return
  timer = setTimeout(() => {
    timer = undefined
    io.emit('stats-updated')
  }, 1000)
}
