// Additive only: ordinary non-unique indexes, no TTL/partial/hidden indexes.
module.exports = [
  { collection: 'users', model: 'src/modules/user/user.model.ts', key: { lastActiveAt: -1 } },
  { collection: 'usageviews', model: 'src/modules/stats/usageView.model.ts', key: { lastSeenAt: -1 } },
  { collection: 'usageviewdays', model: 'src/modules/stats/usageViewDay.model.ts', key: { lastSeenAt: -1 } },
  { collection: 'payments', model: 'src/modules/payment/payment.model.ts', key: { status: 1, createdAt: -1 } },
  { collection: 'payments', model: 'src/modules/payment/payment.model.ts', key: { mapId: 1, status: 1, createdAt: -1 } },
  { collection: 'offerredemptions', model: 'src/modules/offer/offerRedemption.model.ts', key: { offer: 1, redemptionTime: -1 } },
  { collection: 'offerredemptions', model: 'src/modules/offer/offerRedemption.model.ts', key: { redemptionTime: -1 } },
  { collection: 'favourites', model: 'src/modules/favourite/favourite.model.ts', key: { user: 1, createdAt: -1 } },
  { collection: 'reviews', model: 'src/modules/review/review.model.ts', key: { reviewer: 1, createdAt: -1 } },
  { collection: 'reviews', model: 'src/modules/review/review.model.ts', key: { placeId: 1, createdAt: -1 } },
  { collection: 'reviews', model: 'src/modules/review/review.model.ts', key: { businessId: 1, createdAt: -1 } },
  { collection: 'places', model: 'src/modules/place/place.model.ts', key: { map: 1, status: 1, createdAt: -1 } },
  { collection: 'maps', model: 'src/modules/map/map.model.ts', key: { status: 1, isActive: 1, createdAt: -1 } },
].map(index => ({ ...index, name: Object.entries(index.key).map(([field, order]) => `${field}_${order}`).join('_') }))
