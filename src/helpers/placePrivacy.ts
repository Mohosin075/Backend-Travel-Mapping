/** Public marker fields only. Locked locations must not carry detail payloads. */
export const lockedPlaceTeaser = (place: any) => {
  const source = typeof place?.toObject === 'function' ? place.toObject() : place
  const teaser: Record<string, any> = {}
  for (const key of [
    '_id', 'id', 'name', 'type', 'placeType', 'status', 'country',
    'address', 'municipality', 'region', 'town', 'category', 'media',
    'rating', 'totalReview', 'createdAt', 'isNewlyAdded', 'isVisited',
  ]) {
    if (source?.[key] !== undefined) teaser[key] = source[key]
  }
  if (source?.map) {
    if (typeof source.map === 'object' && !source.map._bsontype) {
      teaser.map = {}
      for (const key of ['_id', 'id', 'name', 'country', 'status', 'isPaid']) {
        if (source.map[key] !== undefined) teaser.map[key] = source.map[key]
      }
    } else {
      teaser.map = source.map
    }
  }
  if (source?.location) {
    teaser.location = {}
    for (const key of ['type', 'coordinates', 'address', 'city', 'state', 'country', 'municipality', 'region', 'town']) {
      if (source.location[key] !== undefined) teaser.location[key] = source.location[key]
    }
  }
  return { ...teaser, isLocked: true }
}
