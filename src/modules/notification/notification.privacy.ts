/** Broadcasts have no recipient context: always use generic location text. */
export function sanitizeLocationNotification(
  value: any,
  accessibleMapIds: readonly string[] = [],
  privileged = false,
): any {
  if (!value || value.type !== 'NEW_LOCATION') return value
  const notification = typeof value.toObject === 'function' ? value.toObject() : value
  const map = notification.metadata?.mapId || notification.metadata?.map
  const mapId = map && String(map._id || map.id || map)
  if (privileged || (mapId && accessibleMapIds.includes(mapId))) {
    return {
      ...notification,
      metadata: { ...notification.metadata, canRevealPlace: true },
    }
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
  }
}
