import ApiError from '../../errors/ApiError'
import { StatusCodes } from 'http-status-codes'
import { Map } from '../map/map.model'
import { Place } from '../place/place.model'
import { Offer } from '../offer/offer.model'
import { OfferRedemption } from '../offer/offerRedemption.model'
import { User } from '../user/user.model'
import { Business } from '../business/business.model'
import { Payment } from '../payment/payment.model'
import { rankedViewers, entityViewers, distinctViewers } from './usage-reporting'
import { Visited } from '../visited/visited.model'
import { Review } from '../review/review.model'
import mongoose from 'mongoose'
import { localizeField } from '../../helpers/localize'
import {
  IActiveUserSummary,
  IDashboardData,
  IRecentActivity,
  IReportsData,
  ISalesAndTaxesMonthly,
  ISearchMatchItem,
  IUsageItem,
  IUserActivityItem,
  IUserActivityStats,
} from './stats.interface'

const getDashboardData = async (): Promise<IDashboardData> => {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  // Run DB queries in parallel
  const [
    totalMaps,
    regularPlacesCount,
    businessPlacesCount,
    activeOffers,
    recentMaps,
    recentPlaces,
    recentOffers,
    recentUsers,
    paymentsTotalAgg,
    paymentsMonthAgg,
  ] = await Promise.all([
    Map.countDocuments(),
    Place.countDocuments(),
    Business.countDocuments({ status: 'Approved' }),
    Offer.countDocuments({ status: { $in: ['ACTIVE', 'Active', 'active'] } }),
    Map.find().sort({ createdAt: -1 }).limit(3).select('name createdAt').lean(),
    Place.find().sort({ updatedAt: -1 }).limit(3).select('name updatedAt').lean(),
    Offer.find().sort({ createdAt: -1 }).limit(3).select('title createdAt').lean(),
    User.find().sort({ updatedAt: -1 }).limit(3).select('name role updatedAt').lean(),
    Payment.aggregate([
      { $match: { status: 'succeeded' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { status: 'succeeded', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ])

  const totalPlaces = regularPlacesCount + businessPlacesCount
  const realTotalSales = paymentsTotalAgg[0]?.total || 0
  const realMonthSales = paymentsMonthAgg[0]?.total || 0

  // Report actual persisted revenue, including zero-sales periods.
  const totalSales = realTotalSales
  const thisMonthRevenue = realMonthSales
  const taxesCollected = Math.round(totalSales * 0.10 * 100) / 100

  const recentActivity: IRecentActivity[] = []

  const getSafeStr = (val: any): string => {
    if (!val) return 'Unknown'
    if (typeof val === 'string') return val
    if (typeof val === 'object') {
      return val.en || val.es || Object.values(val)[0] || 'Unknown'
    }
    return String(val)
  }

  recentPlaces.forEach((place: any) => {
    recentActivity.push({
      id: place._id.toString(),
      type: 'place',
      message: `Place updated: ${getSafeStr(place.name)}`,
      timestamp: place.updatedAt,
    })
  })

  recentOffers.forEach((offer: any) => {
    recentActivity.push({
      id: offer._id.toString(),
      type: 'offer',
      message: `Offer published: ${getSafeStr(offer.title)}`,
      timestamp: offer.createdAt,
    })
  })

  recentMaps.forEach((map: any) => {
    recentActivity.push({
      id: map._id.toString(),
      type: 'map',
      message: `Map created: ${getSafeStr(map.name)}`,
      timestamp: map.createdAt,
    })
  })

  recentUsers.forEach((user: any) => {
    recentActivity.push({
      id: user._id.toString(),
      type: 'user',
      message: `User role changed: ${user.name || 'Unknown User'} to ${user.role}`,
      timestamp: user.updatedAt,
    })
  })

  // Sort by timestamp descending and take top 6
  recentActivity.sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  )

  return {
    stats: {
      totalMaps,
      totalPlaces,
      activeOffers,
      totalSales,
      thisMonthRevenue,
      taxesCollected,
    },
    recentActivity: recentActivity.slice(0, 6),
  }
}

const getDateRangeQuery = (timeFilter?: string) => {
  const now = new Date()
  let startDate: Date | null = null
  let endDate: Date | null = null

  if (timeFilter === 'today') {
    startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    endDate = new Date()
    endDate.setHours(23, 59, 59, 999)
  } else if (timeFilter === 'this_week') {
    startDate = new Date()
    const day = startDate.getDay()
    const diff = startDate.getDate() - day + (day === 0 ? -6 : 1) // Monday
    startDate.setDate(diff)
    startDate.setHours(0, 0, 0, 0)
    endDate = new Date()
    endDate.setHours(23, 59, 59, 999)
  } else if (timeFilter === 'this_month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    endDate = new Date()
    endDate.setHours(23, 59, 59, 999)
  } else if (timeFilter === 'last_month') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  }

  if (startDate && endDate) {
    return { $gte: startDate, $lte: endDate }
  }
  return null
}

const isObjectId = (id?: string) =>
  typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const searchReportEntities = async (
  searchTerm?: string,
): Promise<ISearchMatchItem[]> => {
  const q = searchTerm?.trim()
  if (!q || q.length < 2) return []

  const searchRegex = { $regex: escapeRegex(q), $options: 'i' }
  const [matchedPlaces, matchedBusinesses, matchedMaps, matchedOffers] =
    await Promise.all([
      Place.find({
        $or: [
          { name: searchRegex },
          { 'name.en': searchRegex },
          { 'name.es': searchRegex },
          { address: searchRegex },
          { 'address.en': searchRegex },
          { 'address.es': searchRegex },
          { country: searchRegex },
          { 'location.address': searchRegex },
          { 'location.city': searchRegex },
        ],
      })
        .select('name country address location')
        .limit(6)
        .lean(),
      Business.find({
        $or: [
          { name: searchRegex },
          { 'name.en': searchRegex },
          { 'name.es': searchRegex },
          { 'location.address': searchRegex },
          { 'location.city': searchRegex },
          { 'location.country': searchRegex },
        ],
      })
        .select('name location.country location.city location.address')
        .limit(6)
        .lean(),
      Map.find({
        $or: [
          { name: searchRegex },
          { 'name.en': searchRegex },
          { 'name.es': searchRegex },
          { country: searchRegex },
        ],
      })
        .select('name country')
        .limit(5)
        .lean(),
      Offer.find({
        $or: [
          { title: searchRegex },
          { 'title.en': searchRegex },
          { 'title.es': searchRegex },
        ],
      })
        .select('title business place')
        .populate('business', 'name')
        .populate('place', 'name')
        .limit(5)
        .lean(),
    ])

  return [
    ...matchedPlaces.map((p: any) => ({
      type: 'place' as const,
      id: String(p._id),
      name: localizeField(p.name, 'en') || localizeField(p.name, 'es') || (typeof p.name === 'string' ? p.name : ''),
      location: [
        localizeField(p.address, 'en') || localizeField(p.address, 'es') || p.location?.city,
        p.country || p.location?.country,
      ]
        .filter(Boolean)
        .join(', '),
    })),
    ...matchedBusinesses.map((b: any) => ({
      type: 'business' as const,
      id: String(b._id),
      name: localizeField(b.name, 'en') || localizeField(b.name, 'es') || (typeof b.name === 'string' ? b.name : ''),
      location: [
        localizeField(b.location?.address, 'en') ||
        localizeField(b.location?.address, 'es') ||
        b.location?.city,
        b.location?.country,
      ]
        .filter(Boolean)
        .join(', '),
    })),
    ...matchedMaps.map((m: any) => ({
      type: 'map' as const,
      id: String(m._id),
      name: localizeField(m.name, 'en') || localizeField(m.name, 'es') || (typeof m.name === 'string' ? m.name : ''),
      location: m.country || '',
    })),
    ...matchedOffers.map((o: any) => ({
      type: 'offer' as const,
      id: String(o._id),
      name: localizeField(o.title, 'en') || localizeField(o.title, 'es') || (typeof o.title === 'string' ? o.title : ''),
      location: o.business?.name
        ? (localizeField(o.business.name, 'en') || localizeField(o.business.name, 'es') || (typeof o.business.name === 'string' ? o.business.name : ''))
        : o.place?.name
          ? (localizeField(o.place.name, 'en') || localizeField(o.place.name, 'es') || (typeof o.place.name === 'string' ? o.place.name : ''))
          : '',
    })),
  ]
}

type EntityFilterResult = {
  mapIds: string[]
  usagePlace?: IUsageItem
}

const applySelectedEntity = async (
  query: Record<string, any>,
  mapFilter: Record<string, any>,
  placeFilter: Record<string, any>,
  offerFilter: Record<string, any>,
): Promise<EntityFilterResult> => {
  const entityType = String(query.entityType || '')
  const entityId = String(query.entityId || '')
  if (!isObjectId(entityId)) return { mapIds: [] }

  const oid = new mongoose.Types.ObjectId(entityId)

  if (entityType === 'place') {
    const place = await Place.findById(oid).select('map').lean()
    placeFilter._id = oid
    offerFilter.place = oid
    if (place?.map) {
      mapFilter._id = place.map
      return { mapIds: [String(place.map)] }
    }
    mapFilter._id = { $in: [] }
    return { mapIds: [] }
  }

  if (entityType === 'business') {
    offerFilter.business = oid
    placeFilter._id = { $in: [] }
    mapFilter._id = { $in: [] }
    const business = await Business.findById(oid).select('name viewCount').lean()
    return {
      mapIds: [],
      usagePlace: business
        ? {
            entityType: 'business',
            id: String(business._id),
            name: localizeField(business.name),
            count: (business as any).viewCount || 0,
          }
        : undefined,
    }
  }

  if (entityType === 'map') {
    mapFilter._id = oid
    placeFilter.map = oid
    const placesOnMap = await Place.find({ map: oid }, '_id').lean()
    offerFilter.$or = [{ place: { $in: placesOnMap.map(p => p._id) } }]
    return { mapIds: [entityId] }
  }

  if (entityType === 'offer') {
    offerFilter._id = oid
    const offer = await Offer.findById(oid).select('place business').lean()
    if (offer?.place) {
      placeFilter._id = offer.place
      const place = await Place.findById(offer.place).select('map').lean()
      if (place?.map) {
        mapFilter._id = place.map
        return { mapIds: [String(place.map)] }
      }
    } else if (offer?.business) {
      placeFilter._id = { $in: [] }
      mapFilter._id = { $in: [] }
      const business = await Business.findById(offer.business)
        .select('name viewCount')
        .lean()
      return {
        mapIds: [],
        usagePlace: business
          ? {
            entityType: 'business',
            id: String(business._id),
            name: localizeField(business.name),
            count: (business as any).viewCount || 0,
          }
          : undefined,
      }
    } else {
      placeFilter._id = { $in: [] }
      mapFilter._id = { $in: [] }
    }
    return { mapIds: [] }
  }

  return { mapIds: [] }
}

const getReportsData = async (query: Record<string, any> = {}): Promise<IReportsData> => {
  // 1. Parse and sanitize input filters
  const countryParam = typeof query.country === 'string' && query.country.trim() ? query.country.trim() : null
  const countryRegex = countryParam ? new RegExp(`^${escapeRegex(countryParam)}$`, 'i') : null

  const categoryParam = typeof query.category === 'string' && isObjectId(query.category) ? query.category : null
  const categoryOid = categoryParam ? new mongoose.Types.ObjectId(categoryParam) : null

  const dateRange = query.timeFilter ? getDateRangeQuery(query.timeFilter) : null
  const hasEntity = isObjectId(String(query.entityId || '')) && !!query.entityType

  // Construct filters for Maps, Places, Businesses, Offers
  const mapFilter: Record<string, any> = {}
  const placeFilter: Record<string, any> = {}
  const offerFilter: Record<string, any> = {}

  if (countryRegex) {
    placeFilter.country = countryRegex
    mapFilter.country = countryRegex
  }

  if (categoryOid) {
    placeFilter.category = categoryOid
    const placesInCat = await Place.find({ category: categoryOid }, 'map').lean()
    const mapIds = Array.from(
      new Set(placesInCat.map(p => p.map?.toString()).filter(Boolean)),
    )
    mapFilter._id = { $in: mapIds.map(id => new mongoose.Types.ObjectId(id)) }
  }

  if (!hasEntity && (countryRegex || categoryOid)) {
    const placeConditions: Record<string, any> = {}
    if (countryRegex) placeConditions.country = countryRegex
    if (categoryOid) placeConditions.category = categoryOid
    const placesForOffer = await Place.find(placeConditions, '_id').lean()

    const businessConditions: Record<string, any> = {}
    if (countryRegex) businessConditions['location.country'] = countryRegex
    if (categoryOid) businessConditions.category = categoryOid
    const businessesForOffer = await Business.find(businessConditions, '_id').lean()

    offerFilter.$or = [
      { place: { $in: placesForOffer.map(p => p._id) } },
      { business: { $in: businessesForOffer.map(b => b._id) } },
    ]
  }

  // Selected place / business / map / offer (applied after defaults)
  const { usagePlace } = await applySelectedEntity(
    query,
    mapFilter,
    placeFilter,
    offerFilter,
  )

  // Fetch allowed docs based on computed filters
  const allowedMapDocs = await Map.find(mapFilter)
    .select('_id name country places viewCount')
    .lean()
  const allowedMapIds = allowedMapDocs.map(m => m._id.toString())
  const allowedMapOids = allowedMapDocs.map(m => m._id)

  const allowedPlaceDocs = await Place.find(placeFilter)
    .select('_id name openCount')
    .lean()
  const allowedPlaceIds = allowedPlaceDocs.map(p => p._id.toString())
  const allowedPlaceOids = allowedPlaceDocs.map(p => p._id)

  const businessFilter: Record<string, any> = {}
  if (countryRegex) businessFilter['location.country'] = countryRegex
  if (categoryOid) businessFilter.category = categoryOid
  if (query.entityType === 'business' && isObjectId(query.entityId)) {
    businessFilter._id = new mongoose.Types.ObjectId(query.entityId)
  }
  const allowedBusinessDocs = await Business.find(businessFilter)
    .select('_id name')
    .lean()
  const allowedBusinessIds = allowedBusinessDocs.map(b => b._id.toString())
  const allowedBusinessOids = allowedBusinessDocs.map(b => b._id)

  const allowedOfferDocs = await Offer.find(offerFilter).select('_id').lean()
  const allowedOfferOids = allowedOfferDocs.map(o => o._id)

  // ==================== SALES & TAXES CALCULATION ====================
  const paymentFilter: Record<string, any> = { status: 'succeeded' }
  if (dateRange) paymentFilter.createdAt = dateRange
  if (allowedMapOids.length > 0) {
    paymentFilter.mapId = { $in: allowedMapOids }
  } else if (mapFilter._id || mapFilter.country || categoryOid || hasEntity) {
    paymentFilter.mapId = { $in: [] }
  }
  const payments = await Payment.find(paymentFilter).lean()

  let totalSales = 0
  payments.forEach(p => {
    totalSales += p.amount || 0
  })
  const taxesCollected = Math.round(totalSales * 0.1 * 100) / 100
  const netRevenue = Math.round((totalSales - taxesCollected) * 100) / 100

  // Monthly sales & tax grouping
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthlyMap: Record<string, { totalSales: number; taxes: number; netRevenue: number }> = {}
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = monthNames[d.getMonth()]
    monthlyMap[label] = { totalSales: 0, taxes: 0, netRevenue: 0 }
  }

  payments.forEach(p => {
    const date = new Date(p.createdAt)
    const label = monthNames[date.getMonth()]
    if (monthlyMap[label] !== undefined) {
      monthlyMap[label].totalSales += p.amount || 0
    }
  })

  const monthlyData = Object.keys(monthlyMap).map(month => {
    const data = monthlyMap[month]
    const taxes = Math.round(data.totalSales * 0.1 * 100) / 100
    const rev = Math.round((data.totalSales - taxes) * 100) / 100
    return {
      month,
      totalSales: data.totalSales,
      taxes,
      netRevenue: rev,
    }
  })

  // ==================== USAGE STATS & RANKINGS ====================
  // Pre-calculate place counts for each map (Issue 5 Requirement)
  const mapPlaceCounts = await Place.aggregate([
    { $match: { map: { $in: allowedMapOids } } },
    { $group: { _id: '$map', count: { $sum: 1 } } },
  ])
  const mapPlaceCountMap = new globalThis.Map<string, number>(
    mapPlaceCounts.map(p => [String(p._id), p.count]),
  )
  const mapDocMap = new globalThis.Map<string, any>(
    allowedMapDocs.map(m => [String(m._id), m]),
  )

  // Counts and viewer drilldowns use the same deduplicated records, not lifetime
  // counters that also include repeat visits and unidentifiable historical opens.
  const [mapRanks, placeRanks] = await Promise.all([
    rankedViewers('map', allowedMapIds, dateRange),
    rankedViewers('place', allowedPlaceIds, dateRange),
  ])
  const rankedMapIds = new Set(mapRanks.map(r => String(r._id)))
  const mapsWithCounts = [...mapRanks, ...allowedMapDocs.filter(m => !rankedMapIds.has(String(m._id))).map(m => ({ _id: m._id, count: 0 }))]
    .sort((a, b) => b.count - a.count || String(a._id).localeCompare(String(b._id))).slice(0, 20)
  const mostViewedMaps: IUsageItem[] = mapsWithCounts.map(r => {
    const doc = mapDocMap.get(String(r._id))
    return {
      id: String(r._id), name: localizeField(doc?.name), count: r.count,
      placesCount: mapPlaceCountMap.get(String(r._id)) || 0, country: doc?.country,
      countMetric: 'unique_viewers' as const,
      ...(!dateRange ? { totalViews: doc?.viewCount || 0 } : {}),
    }
  })
  const placeDocMap = new globalThis.Map(allowedPlaceDocs.map(p => [String(p._id), p]))
  const rankedPlaceIds = new Set(placeRanks.map(r => String(r._id)))
  const placesWithCounts = [...placeRanks, ...allowedPlaceDocs.filter(p => !rankedPlaceIds.has(String(p._id))).map(p => ({ _id: p._id, count: 0 }))]
    .sort((a, b) => b.count - a.count || String(a._id).localeCompare(String(b._id))).slice(0, 20)
  let mostOpenedPlaces: IUsageItem[] = placesWithCounts.map(r => ({
    id: String(r._id), name: localizeField(placeDocMap.get(String(r._id))?.name),
    count: r.count, countMetric: 'unique_viewers' as const,
    ...(!dateRange ? { totalViews: placeDocMap.get(String(r._id))?.openCount || 0 } : {}),
  }))
  if (usagePlace) {
    if (usagePlace.entityType === 'business') {
      const ranks = await rankedViewers('business', [usagePlace.id!], dateRange)
      if (!dateRange) usagePlace.totalViews = usagePlace.count
      usagePlace.count = ranks[0]?.count || 0
      usagePlace.countMetric = 'unique_viewers'
    }
    mostOpenedPlaces = [usagePlace]
  }

  let mostRedeemedOffers: IUsageItem[] = []
  if (dateRange) {
    const scopedOffers = await Offer.find(offerFilter)
      .select('_id title business place')
      .populate('business', 'name')
      .populate('place', 'name')
      .lean()
    const scopedIds = scopedOffers.map(o => o._id)
    const redemptionMatch: Record<string, any> = { redemptionTime: dateRange }
    if (scopedIds.length > 0) {
      redemptionMatch.offer = { $in: scopedIds }
    } else if (Object.keys(offerFilter).length > 0) {
      redemptionMatch.offer = { $in: [] }
    }
    const redemptionAgg = await OfferRedemption.aggregate([
      { $match: redemptionMatch },
      { $group: { _id: '$offer', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ])

    if (redemptionAgg.length > 0) {
      const offerInfoById = new globalThis.Map<
        string,
        {
          title: string;
          businessName?: string;
          businessId?: string;
          placeId?: string;
        }
      >(
        scopedOffers.map((o: any) => [
          String(o._id),
          {
            title: localizeField(o.title),
            businessName: o.business?.name
              ? localizeField(o.business.name)
              : o.place?.name
                ? localizeField(o.place.name)
                : undefined,
            businessId: o.business?._id ? String(o.business._id) : undefined,
            placeId: o.place?._id ? String(o.place._id) : undefined,
          },
        ]),
      )
      const missingIds = redemptionAgg
        .map((r: any) => r._id)
        .filter((id: any) => !offerInfoById.has(String(id)))
      if (missingIds.length) {
        const extra = await Offer.find({ _id: { $in: missingIds } })
          .select('_id title business place')
          .populate('business', 'name')
          .populate('place', 'name')
          .lean()
        extra.forEach((o: any) =>
          offerInfoById.set(String(o._id), {
            title: localizeField(o.title),
            businessName: o.business?.name
              ? localizeField(o.business.name)
              : o.place?.name
                ? localizeField(o.place.name)
                : undefined,
            businessId: o.business?._id ? String(o.business._id) : undefined,
            placeId: o.place?._id ? String(o.place._id) : undefined,
          }),
        )
      }
      mostRedeemedOffers = redemptionAgg.map((r: any) => {
        const info = offerInfoById.get(String(r._id))
        return {
          id: String(r._id),
          name: info?.title || 'Unknown offer',
          businessName: info?.businessName,
          businessId: info?.businessId,
          placeId: info?.placeId,
          count: r.count || 0,
        }
      })
    } else {
      mostRedeemedOffers = scopedOffers.slice(0, 20).map((o: any) => ({
        id: String(o._id),
        name: localizeField(o.title),
        businessName: o.business?.name
          ? localizeField(o.business.name)
          : o.place?.name
            ? localizeField(o.place.name)
            : undefined,
        businessId: o.business?._id ? String(o.business._id) : undefined,
        placeId: o.place?._id ? String(o.place._id) : undefined,
        count: 0,
      }))
    }
  } else {
    const mostRedeemedOffersRaw = await Offer.find(offerFilter)
      .sort({ redemptionsCount: -1 })
      .limit(20)
      .select('title redemptionsCount business place')
      .populate('business', 'name')
      .populate('place', 'name')
      .lean()
    mostRedeemedOffers = mostRedeemedOffersRaw.map((o: any) => ({
      id: String(o._id),
      name: localizeField(o.title),
      businessName: o.business?.name
        ? localizeField(o.business.name)
        : o.place?.name
          ? localizeField(o.place.name)
          : undefined,
      businessId: o.business?._id ? String(o.business._id) : undefined,
      placeId: o.place?._id ? String(o.place._id) : undefined,
      count: o.redemptionsCount || 0,
    }))
  }

  // ==================== USER ACTIVITY & ENGAGEMENT ====================
  // Build scoped filters for Visited, Review, and OfferRedemption
  const visitedFilter: Record<string, any> = {}
  const reviewFilter: Record<string, any> = {}
  const redemptionFilter: Record<string, any> = {}

  if (dateRange) {
    visitedFilter.visitedAt = dateRange
    reviewFilter.createdAt = dateRange
    redemptionFilter.redemptionTime = dateRange
  }

  if (query.entityType === 'place' && isObjectId(query.entityId)) {
    const oid = new mongoose.Types.ObjectId(query.entityId)
    visitedFilter.place = oid
    reviewFilter.placeId = oid
    redemptionFilter.offer = { $in: allowedOfferOids }
  } else if (query.entityType === 'business' && isObjectId(query.entityId)) {
    const oid = new mongoose.Types.ObjectId(query.entityId)
    visitedFilter.business = oid
    reviewFilter.businessId = oid
    redemptionFilter.offer = { $in: allowedOfferOids }
  } else if (query.entityType === 'map' && isObjectId(query.entityId)) {
    visitedFilter.place = { $in: allowedPlaceOids }
    reviewFilter.placeId = { $in: allowedPlaceOids }
    redemptionFilter.offer = { $in: allowedOfferOids }
  } else if (query.entityType === 'offer' && isObjectId(query.entityId)) {
    const oid = new mongoose.Types.ObjectId(query.entityId)
    redemptionFilter.offer = oid
    if (placeFilter._id) {
      visitedFilter.place = placeFilter._id
      reviewFilter.placeId = placeFilter._id
    } else if (offerFilter.business) {
      visitedFilter.business = offerFilter.business
      reviewFilter.businessId = offerFilter.business
    }
  } else if (countryRegex || categoryOid) {
    const targetPlaceConditions: any[] = []
    const targetReviewConditions: any[] = []

    if (allowedPlaceOids.length > 0) {
      targetPlaceConditions.push({ place: { $in: allowedPlaceOids } })
      targetReviewConditions.push({ placeId: { $in: allowedPlaceOids } })
    }
    if (allowedBusinessOids.length > 0) {
      targetPlaceConditions.push({ business: { $in: allowedBusinessOids } })
      targetReviewConditions.push({ businessId: { $in: allowedBusinessOids } })
    }

    if (targetPlaceConditions.length > 0) {
      visitedFilter.$or = targetPlaceConditions
      reviewFilter.$or = targetReviewConditions
    } else {
      visitedFilter._id = { $in: [] }
      reviewFilter._id = { $in: [] }
    }

    if (allowedOfferOids.length > 0) {
      redemptionFilter.offer = { $in: allowedOfferOids }
    } else {
      redemptionFilter._id = { $in: [] }
    }
  }

  // Active user distinct query filters
  const activityEnd = Math.min(Date.now(), dateRange?.$lte?.getTime() ?? Date.now())
  const activityStart = (days: number) => new Date(Math.max(
    activityEnd - days * 24 * 60 * 60 * 1000,
    dateRange?.$gte?.getTime() ?? 0,
  ))
  const oneDayAgo = activityStart(1)
  const sevenDaysAgo = activityStart(7)
  const thirtyDaysAgo = activityStart(30)

  const usageEntityMatch: Record<string, any> = {}
  if (hasEntity) {
    if (['map', 'place', 'business'].includes(query.entityType)) {
      usageEntityMatch.type = query.entityType
      usageEntityMatch.entityId = String(query.entityId)
    } else {
      usageEntityMatch._id = { $in: [] }
    }
  } else if (countryRegex || categoryOid) {
    const orConditions: any[] = []
    if (allowedMapIds.length > 0) {
      orConditions.push({ type: 'map', entityId: { $in: allowedMapIds } })
    }
    if (allowedPlaceIds.length > 0) {
      orConditions.push({ type: 'place', entityId: { $in: allowedPlaceIds } })
    }
    if (allowedBusinessIds.length > 0) {
      orConditions.push({ type: 'business', entityId: { $in: allowedBusinessIds } })
    }
    if (orConditions.length > 0) {
      usageEntityMatch.$or = orConditions
    } else {
      usageEntityMatch._id = { $in: [] }
    }
  }

  const visitedTimeMatch = (threshold: Date) => ({
    ...visitedFilter,
    visitedAt: { $gte: threshold, ...(dateRange?.$lte ? { $lte: dateRange.$lte } : {}) },
  })
  const reviewTimeMatch = (threshold: Date) => ({
    ...reviewFilter,
    createdAt: { $gte: threshold, ...(dateRange?.$lte ? { $lte: dateRange.$lte } : {}) },
  })
  const redemptionTimeMatch = (threshold: Date) => ({
    ...redemptionFilter,
    redemptionTime: { $gte: threshold, ...(dateRange?.$lte ? { $lte: dateRange.$lte } : {}) },
  })
  const usageTimeMatch = (threshold: Date) => ({
    ...usageEntityMatch,
    lastSeenAt: { $gte: threshold, ...(dateRange?.$lte ? { $lte: dateRange.$lte } : {}) },
  })

  // User registered filtering
  const userCountFilter: Record<string, any> = {}
  if (countryRegex) {
    userCountFilter['address.country'] = countryRegex
  }

  const totalRegisteredUsers = await User.countDocuments(userCountFilter)

  const [
    usageKeysToday,
    usageKeysWeek,
    usageKeysMonth,
    visitedUsersToday,
    visitedUsersWeek,
    visitedUsersMonth,
    reviewUsersToday,
    reviewUsersWeek,
    reviewUsersMonth,
    redemptionUsersToday,
    redemptionUsersWeek,
    redemptionUsersMonth,
    updatedUsersToday,
    updatedUsersWeek,
    updatedUsersMonth,
    totalPlacesVisited,
    totalOffersRedeemed,
    totalReviews,
    recentVisits,
    recentReviews,
    recentRedemptions,
    recentUsers,
  ] = await Promise.all([
    distinctViewers(usageTimeMatch(oneDayAgo)),
    distinctViewers(usageTimeMatch(sevenDaysAgo)),
    distinctViewers(usageTimeMatch(thirtyDaysAgo)),
    Visited.distinct('user', visitedTimeMatch(oneDayAgo)),
    Visited.distinct('user', visitedTimeMatch(sevenDaysAgo)),
    Visited.distinct('user', visitedTimeMatch(thirtyDaysAgo)),
    Review.distinct('reviewer', reviewTimeMatch(oneDayAgo)),
    Review.distinct('reviewer', reviewTimeMatch(sevenDaysAgo)),
    Review.distinct('reviewer', reviewTimeMatch(thirtyDaysAgo)),
    OfferRedemption.distinct('user', redemptionTimeMatch(oneDayAgo)),
    OfferRedemption.distinct('user', redemptionTimeMatch(sevenDaysAgo)),
    OfferRedemption.distinct('user', redemptionTimeMatch(thirtyDaysAgo)),
    hasEntity || categoryOid ? Promise.resolve([]) : User.distinct('_id', { lastActiveAt: { $gte: oneDayAgo, $lte: new Date(activityEnd) }, ...userCountFilter }),
    hasEntity || categoryOid ? Promise.resolve([]) : User.distinct('_id', { lastActiveAt: { $gte: sevenDaysAgo, $lte: new Date(activityEnd) }, ...userCountFilter }),
    hasEntity || categoryOid ? Promise.resolve([]) : User.distinct('_id', { lastActiveAt: { $gte: thirtyDaysAgo, $lte: new Date(activityEnd) }, ...userCountFilter }),
    Visited.countDocuments(visitedFilter),
    OfferRedemption.countDocuments(redemptionFilter),
    Review.countDocuments(reviewFilter),
    Visited.find(visitedFilter)
      .sort({ visitedAt: -1 })
      .limit(10)
      .populate('user', 'name email profile')
      .populate('place', 'name')
      .populate('business', 'name')
      .lean(),
    Review.find(reviewFilter)
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('reviewer', 'name email profile')
      .populate('placeId', 'name')
      .populate('businessId', 'name')
      .lean(),
    OfferRedemption.find(redemptionFilter)
      .sort({ redemptionTime: -1 })
      .limit(10)
      .populate('user', 'name email profile')
      .populate('offer', 'title')
      .lean(),
    hasEntity
      ? Promise.resolve([])
      : User.find(countryRegex ? { 'address.country': countryRegex } : {})
          .sort({ createdAt: -1 })
          .limit(8)
          .select('name email profile createdAt role')
          .lean(),
  ])

  const activeTodaySet = new Set<string>()
  usageKeysToday.forEach((k: any) => activeTodaySet.add(String(k)))
  visitedUsersToday.forEach((u: any) => activeTodaySet.add(`user:${String(u)}`))
  reviewUsersToday.forEach((u: any) => activeTodaySet.add(`user:${String(u)}`))
  redemptionUsersToday.forEach((u: any) => activeTodaySet.add(`user:${String(u)}`))
  updatedUsersToday.forEach((u: any) => activeTodaySet.add(`user:${String(u)}`))

  const activeWeekSet = new Set<string>()
  usageKeysWeek.forEach((k: any) => activeWeekSet.add(String(k)))
  visitedUsersWeek.forEach((u: any) => activeWeekSet.add(`user:${String(u)}`))
  reviewUsersWeek.forEach((u: any) => activeWeekSet.add(`user:${String(u)}`))
  redemptionUsersWeek.forEach((u: any) => activeWeekSet.add(`user:${String(u)}`))
  updatedUsersWeek.forEach((u: any) => activeWeekSet.add(`user:${String(u)}`))

  const activeMonthSet = new Set<string>()
  usageKeysMonth.forEach((k: any) => activeMonthSet.add(String(k)))
  visitedUsersMonth.forEach((u: any) => activeMonthSet.add(`user:${String(u)}`))
  reviewUsersMonth.forEach((u: any) => activeMonthSet.add(`user:${String(u)}`))
  redemptionUsersMonth.forEach((u: any) => activeMonthSet.add(`user:${String(u)}`))
  updatedUsersMonth.forEach((u: any) => activeMonthSet.add(`user:${String(u)}`))

  const recentActivities: IUserActivityItem[] = []

  recentVisits.forEach((v: any) => {
    recentActivities.push({
      id: String(v._id),
      type: 'visit',
      userId: v.user?._id ? String(v.user._id) : (v.user ? String(v.user) : undefined),
      userName: v.user?.name || 'Explorer',
      userEmail: v.user?.email,
      userProfile: v.user?.profile,
      title: 'Visited Place',
      subtitle: v.place?.name
        ? localizeField(v.place.name)
        : v.business?.name
          ? localizeField(v.business.name)
          : undefined,
      targetId: v.place?._id ? String(v.place._id) : v.business?._id ? String(v.business._id) : undefined,
      targetType: v.place?._id ? 'place' : 'business',
      timestamp: v.visitedAt || v.createdAt,
    })
  })

  recentReviews.forEach((r: any) => {
    recentActivities.push({
      id: String(r._id),
      type: 'review',
      userId: r.reviewer?._id ? String(r.reviewer._id) : (r.reviewer ? String(r.reviewer) : undefined),
      userName: r.reviewer?.name || 'Explorer',
      userEmail: r.reviewer?.email,
      userProfile: r.reviewer?.profile,
      title: `Submitted a ${r.rating || 5}★ Review`,
      subtitle: r.placeId?.name
        ? localizeField(r.placeId.name)
        : r.businessId?.name
          ? localizeField(r.businessId.name)
          : undefined,
      targetId: r.placeId?._id ? String(r.placeId._id) : r.businessId?._id ? String(r.businessId._id) : undefined,
      targetType: r.placeId?._id ? 'place' : 'business',
      timestamp: r.createdAt,
    })
  })

  recentRedemptions.forEach((red: any) => {
    recentActivities.push({
      id: String(red._id),
      type: 'redemption',
      userId: red.user?._id ? String(red.user._id) : (red.user ? String(red.user) : undefined),
      userName: red.user?.name || 'Explorer',
      userEmail: red.user?.email,
      userProfile: red.user?.profile,
      title: 'Redeemed Special Offer',
      subtitle: red.offer?.title ? localizeField(red.offer.title) : undefined,
      targetId: red.offer?._id ? String(red.offer._id) : undefined,
      targetType: 'offer',
      timestamp: red.redemptionTime || red.createdAt,
    })
  })

  recentUsers.forEach((u: any) => {
    recentActivities.push({
      id: String(u._id),
      type: 'registration',
      userId: String(u._id),
      userName: u.name || 'New Explorer',
      userEmail: u.email,
      userProfile: u.profile,
      title: 'Joined Roadtripeado',
      subtitle: u.role ? `Role: ${u.role}` : undefined,
      timestamp: u.createdAt,
    })
  })

  recentActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  let finalActiveToday = activeTodaySet.size
  let finalActiveWeek = activeWeekSet.size
  let finalActiveMonth = activeMonthSet.size

  // Query active users to enable profile inspection on statistics page
  const todayUserIds = new Set<string>()
  usageKeysToday.forEach((key: any) => {
    const id = String(key).startsWith('user:') ? String(key).slice(5) : ''
    if (mongoose.Types.ObjectId.isValid(id)) todayUserIds.add(id)
  })
  visitedUsersToday.forEach((u: any) => u && todayUserIds.add(String(u)))
  reviewUsersToday.forEach((u: any) => u && todayUserIds.add(String(u)))
  redemptionUsersToday.forEach((u: any) => u && todayUserIds.add(String(u)))
  updatedUsersToday.forEach((u: any) => u && todayUserIds.add(String(u)))

  const weekUserIds = new Set<string>()
  usageKeysWeek.forEach((key: any) => {
    const id = String(key).startsWith('user:') ? String(key).slice(5) : ''
    if (mongoose.Types.ObjectId.isValid(id)) weekUserIds.add(id)
  })
  visitedUsersWeek.forEach((u: any) => u && weekUserIds.add(String(u)))
  reviewUsersWeek.forEach((u: any) => u && weekUserIds.add(String(u)))
  redemptionUsersWeek.forEach((u: any) => u && weekUserIds.add(String(u)))
  updatedUsersWeek.forEach((u: any) => u && weekUserIds.add(String(u)))

  const monthUserIds = new Set<string>()
  usageKeysMonth.forEach((key: any) => {
    const id = String(key).startsWith('user:') ? String(key).slice(5) : ''
    if (mongoose.Types.ObjectId.isValid(id)) monthUserIds.add(id)
  })
  visitedUsersMonth.forEach((u: any) => u && monthUserIds.add(String(u)))
  reviewUsersMonth.forEach((u: any) => u && monthUserIds.add(String(u)))
  redemptionUsersMonth.forEach((u: any) => u && monthUserIds.add(String(u)))
  updatedUsersMonth.forEach((u: any) => u && monthUserIds.add(String(u)))

  // Inherit subsets: today is part of week, week is part of month
  todayUserIds.forEach((id) => {
    weekUserIds.add(id)
    monthUserIds.add(id)
  })
  weekUserIds.forEach((id) => {
    monthUserIds.add(id)
  })

  const allActiveUserIds = new Set<string>([
    ...Array.from(monthUserIds),
    ...Array.from(weekUserIds),
    ...Array.from(todayUserIds),
  ])

  const validObjectIds = Array.from(allActiveUserIds)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id))

  let activeUsersDocs: any[] = []
  if (validObjectIds.length > 0) {
    activeUsersDocs = await User.find({ _id: { $in: validObjectIds } })
      .select('name email profile role level points lastActiveAt updatedAt createdAt')
      .sort({ lastActiveAt: -1, updatedAt: -1 })
      .lean()
  }

  // Also query general registered users for "all" tab
  const allUsersDocs = await User.find(countryRegex ? { 'address.country': countryRegex } : {})
    .select('name email profile role level points lastActiveAt updatedAt createdAt')
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(100)
    .lean()

  const formatUserSummary = (u: any): IActiveUserSummary => {
    const id = String(u._id)
    const isToday = todayUserIds.has(id)
    const isWeek = isToday || weekUserIds.has(id)
    const isMonth = isWeek || monthUserIds.has(id)
    const periods: ('today' | 'week' | 'month' | 'all')[] = ['all']
    if (isMonth) periods.push('month')
    if (isWeek) periods.push('week')
    if (isToday) periods.push('today')

    return {
      _id: id,
      name: u.name || 'Explorer',
      email: u.email || '',
      profile: u.profile || '',
      role: u.role || 'user',
      level: u.level || 0,
      points: u.points || 0,
      lastActive: u.lastActiveAt || u.updatedAt || u.createdAt || new Date(),
      isActiveToday: isToday,
      isActiveWeek: isWeek,
      isActiveMonth: isMonth,
      periods,
    }
  }

  const activeUsersList = activeUsersDocs.map(formatUserSummary)
  const activeTodayList = activeUsersList.filter((u) => u.isActiveToday)
  const activeWeekList = activeUsersList.filter((u) => u.isActiveWeek)
  const activeMonthList = activeUsersList.filter((u) => u.isActiveMonth)
  const allUsersList = allUsersDocs.map(formatUserSummary)

  const userActivity: IUserActivityStats = {
    activeUsersToday: finalActiveToday,
    activeUsersThisWeek: Math.max(finalActiveToday, finalActiveWeek),
    activeUsersThisMonth: Math.max(finalActiveWeek, finalActiveMonth),
    totalRegisteredUsers,
    totalPlacesVisited,
    totalOffersRedeemed,
    totalReviews,
    recentActivities: recentActivities.slice(0, 25),
    activeUsersList,
    activeTodayList,
    activeWeekList,
    activeMonthList,
    allUsersList,
  }

  return {
    salesAndTaxes: {
      totalSales,
      taxesCollected,
      netRevenue,
      monthlyData,
    },
    usage: {
      mostViewedMaps,
      mostOpenedPlaces,
      mostRedeemedOffers,
    },
    userActivity,
  }
}


const getEntityUsers = async (type: string, id: string, timeFilter?: string) => {
  if (!mongoose.isValidObjectId(id) || !['place', 'business', 'map', 'offer'].includes(type)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid report entity')
  }
  const dateRange = timeFilter ? getDateRangeQuery(timeFilter) : null
  const normType = String(type || '').trim().toLowerCase()

  if (normType === 'place' || normType === 'business' || normType === 'map') {
    const viewList = await entityViewers(normType, id, dateRange)

    const authViewerIds = viewList
      .filter((v: any) => v.viewerKey && v.viewerKey.startsWith('user:'))
      .map((v: any) => v.viewerKey.replace('user:', ''))
      .filter((viewerId: string) => mongoose.isValidObjectId(viewerId))

    const guestCount = viewList.filter(
      (v: any) => !v.viewerKey || !v.viewerKey.startsWith('user:')
    ).length

    const userMap = new globalThis.Map<string, any>()

    if (authViewerIds.length > 0) {
      const viewerUsers = await User.find({ _id: { $in: authViewerIds } })
        .select('name email profile role level points')
        .lean()
      const viewerUserMap = new globalThis.Map(viewerUsers.map(u => [String(u._id), u]))

      viewList.forEach((v: any) => {
        if (v.viewerKey && v.viewerKey.startsWith('user:')) {
          const uId = v.viewerKey.replace('user:', '')
          if (!userMap.has(uId) && viewerUserMap.has(uId)) {
            const u = viewerUserMap.get(uId)!
            userMap.set(uId, {
              _id: uId,
              name: u.name || 'Anonymous User',
              email: u.email,
              profile: u.profile,
              role: u.role,
              level: u.level || 1,
              points: u.points || 0,
              date: v.lastSeenAt || v.updatedAt,
              action: 'Viewed',
            })
          }
        }
      })
    }

    const users = Array.from(userMap.values())
    return {
      users,
      totalCount: viewList.length,
      countMetric: 'unique_viewers',
      unavailableCount: new Set(viewList.filter((v: any) => v.viewerKey?.startsWith('user:')).map((v: any) => v.viewerKey)).size - users.length,
      guestCount,
    }
  }

  if (normType === 'offer') {
    const redemptions = await OfferRedemption.find({ offer: id, ...(dateRange ? { redemptionTime: dateRange } : {}) })
      .populate('user', 'name email profile role level points')
      .sort({ redemptionTime: -1, createdAt: -1 })
      .lean()

    const users = redemptions
      .filter((r: any) => r.user && r.user._id)
      .map((r: any) => ({
        _id: String(r.user._id),
        name: r.user.name || 'Anonymous User',
        email: r.user.email,
        profile: r.user.profile,
        role: r.user.role,
        level: r.user.level || 1,
        points: r.user.points || 0,
        date: r.redemptionTime || r.createdAt,
        action: 'Redeemed',
      }))

    // Redemptions are newest first; retain each person's latest redemption.
    const uniqueUsers = new globalThis.Map<string, (typeof users)[number]>()
    users.forEach(user => {
      if (!uniqueUsers.has(user._id)) uniqueUsers.set(user._id, user)
    })
    return {
      users: Array.from(uniqueUsers.values()),
      totalCount: users.length,
      guestCount: 0,
    }
  }

  return { users: [], totalCount: 0, guestCount: 0 }
}

export const StatsService = {
  getDashboardData,
  getReportsData,
  searchReportEntities,
  getEntityUsers,
}
