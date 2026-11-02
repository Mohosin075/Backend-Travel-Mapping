import { Types } from 'mongoose'
import { StatusCodes } from 'http-status-codes'
import ApiError from '../../errors/ApiError'
import { IOffer } from './offer.interface'
import { Offer } from './offer.model'
import { OfferRedemption } from './offerRedemption.model'
import { getTimeFilterQuery } from '../../helpers/dateHelper'

import QueryBuilder from '../../builder/QueryBuilder'
import { BOGO_SECOND_TYPE, DISCOUNT_TYPE, OFFER_STATUS } from '../../enum/offer'
import { Business } from '../business/business.model'
import { Place } from '../place/place.model'
import { Map as MapModel } from '../map/map.model'
import { autoTranslateField } from '../../utils/autoTranslate'
import {
  getUserFromToken,
  getAccessibleMapIds,
  verifyEditorEditAccess,
  verifyEditorBusinessAccess,
  buildCountryToMapIdLookup,
  resolveOfferMapId,
  resolveOfferMapIdAsync,
} from '../../helpers/mapAccessHelper'
import { USER_ROLES } from '../../enum/user'
import { NotificationIntegration } from '../notification/notification.integration'

const processOfferTranslations = async (payload: Partial<IOffer>) => {
  if (payload.title) payload.title = await autoTranslateField(payload.title)
  if (payload.description) payload.description = await autoTranslateField(payload.description)
  if (payload.buttonLabel) payload.buttonLabel = await autoTranslateField(payload.buttonLabel)
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Strip paid-only fields from locked list items; keep teaser fields for cards. */
const sanitizeLockedOffer = (offer: any) => {
  const {
    description: _description,
    redemptionRules: _redemptionRules,
    ...safe
  } = offer
  return {
    ...safe,
    description: undefined,
    redemptionRules: undefined,
    isLocked: true,
  }
}

const assertUserOwnsBusiness = async (user: any, businessId?: string) => {
  if (!businessId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You can only manage offers for your own business',
    )
  }
  const business = await Business.findById(businessId)
  if (!business) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Business not found')
  }
  const ownerId = (business.user as any)?._id?.toString() || business.user?.toString()
  if (ownerId !== user._id.toString()) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'You can only manage offers for your own business',
    )
  }
  return business
}

const createOffer = async (payload: any, authHeader?: string): Promise<IOffer> => {
  const { images, ...offerData } = payload
  const user = await getUserFromToken(authHeader)

  if (user && user.role === USER_ROLES.USER) {
    await assertUserOwnsBusiness(user, offerData.business)
    delete offerData.place
  }

  // Verify access for Map Editors
  if (user && user.role === USER_ROLES.MAP_EDITOR) {
    if (offerData.place) {
      const place = await Place.findById(offerData.place)
      if (!place) throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
      const mapId = place.map?._id || place.map
      if (mapId) {
        await verifyEditorEditAccess(user, mapId.toString())
      }
    } else if (offerData.business) {
      const business = await Business.findById(offerData.business)
      if (!business) throw new ApiError(StatusCodes.NOT_FOUND, 'Business not found')
      await verifyEditorBusinessAccess(user, business.location?.country)
    }
  }

  // Handle image upload from disk storage
  if (images) {
    offerData.photo = Array.isArray(images) ? images[0] : images
  }

  await processOfferTranslations(offerData)
  if (offerData.discountType === DISCOUNT_TYPE.BOGO && !offerData.bogoSecondType) {
    offerData.bogoSecondType = BOGO_SECOND_TYPE.FREE
  }
  const status = offerData.status || OFFER_STATUS.ACTIVE
  if (status === OFFER_STATUS.ACTIVE && (offerData.place || offerData.business)) {
    const query: any[] = []
    if (offerData.place) query.push({ place: offerData.place })
    if (offerData.business) query.push({ business: offerData.business })

    if (query.length > 0) {
      const existingActiveOffer = await Offer.findOne({
        $or: query,
        status: OFFER_STATUS.ACTIVE,
      })

      if (existingActiveOffer) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'An active offer already exists for this place or business',
        )
      }
    }
  }

  const result = await Offer.create(offerData)

  if (result.status === OFFER_STATUS.ACTIVE) {
    NotificationIntegration.onNewOffer(result).catch(err =>
      console.error('Failed to dispatch new offer notification:', err),
    )
  }

  return result
}

const getAllOffers = async (query: Record<string, unknown>, authHeader?: string) => {
  const queryObj = { ...query }

  // Extract custom query filters before QueryBuilder.filter() runs
  const country =
    typeof queryObj.country === 'string' ? queryObj.country.trim() : ''
  const searchTerm =
    typeof queryObj.searchTerm === 'string' ? queryObj.searchTerm.trim() : ''
  delete queryObj.country
  const map =
    typeof queryObj.map === 'string' ? queryObj.map.trim() : ''
  delete queryObj.map
  delete queryObj.searchTerm

  // Find all approved businesses with active subscriptions
  const activeBusinesses = await Business.find({
    status: 'Approved',
    hasActiveSubscription: true,
  }).select('_id').lean()
  const activeBusinessIds = activeBusinesses.map(b => b._id)

  // Filter offers: must either belong to a place or to an active/approved business
  const filterConditions: any[] = [
    {
      $or: [
        { place: { $exists: true, $ne: null } },
        { business: { $in: activeBusinessIds } },
      ],
    },
  ]

  // Filter by country or map if provided
  if (country || map) {
    const mapOrConditions: any[] = []
    if (map && Types.ObjectId.isValid(map)) {
      mapOrConditions.push({ _id: new Types.ObjectId(map) })
    }
    if (country) {
      if (Types.ObjectId.isValid(country)) {
        mapOrConditions.push({ _id: new Types.ObjectId(country) })
      }
      const cRegex = new RegExp('^' + escapeRegex(country) + '$', 'i')
      mapOrConditions.push(
        { country: cRegex },
        { 'name.en': cRegex },
        { 'name.es': cRegex },
        { name: cRegex },
      )
    }

    const matchingMaps =
      mapOrConditions.length > 0
        ? await (MapModel as any).find({ $or: mapOrConditions }).select('_id name country').lean()
        : []

    const mapIds = matchingMaps.map((m: any) => m._id)
    const mapCountries = matchingMaps.map((m: any) => m.country).filter(Boolean) as string[]
    const mapNames = matchingMaps
      .map((m: any) => (typeof m.name === 'string' ? m.name : (m.name?.es || m.name?.en)))
      .filter(Boolean) as string[]

    const allCountryStrings = Array.from(
      new Set([
        ...(country ? [country] : []),
        ...mapCountries,
        ...mapNames,
      ]),
    )


    const countryRegexes = allCountryStrings.map(
      c => new RegExp('^' + escapeRegex(c) + '$', 'i'),
    )

    const placeOr: any[] = []
    if (countryRegexes.length > 0) {
      placeOr.push({ country: { $in: countryRegexes } })
    }
    if (mapIds.length > 0) {
      placeOr.push({ map: { $in: mapIds } })
    }

    const businessOr: any[] = []
    if (countryRegexes.length > 0) {
      businessOr.push(
        { 'location.country': { $in: countryRegexes } },
        { country: { $in: countryRegexes } },
      )
    }
    if (mapIds.length > 0) {
      businessOr.push({ map: { $in: mapIds } })
    }

    const [matchingPlaces, matchingBusinesses] = await Promise.all([
      placeOr.length > 0
        ? Place.find({ $or: placeOr }).select('_id').lean()
        : Promise.resolve([]),
      businessOr.length > 0
        ? Business.find({ $or: businessOr }).select('_id').lean()
        : Promise.resolve([]),
    ])

    const placeIds = matchingPlaces.map(p => p._id)
    const businessIds = matchingBusinesses.map(b => b._id)

    filterConditions.push({
      $or: [
        { place: { $in: placeIds } },
        { business: { $in: businessIds } },
      ],
    })
  }

  // Search by offer title/description, place name/address/municipality/region, or business name/address/city
  if (searchTerm) {
    const searchRegex = new RegExp(escapeRegex(searchTerm), 'i')

    const [matchingPlaces, matchingBusinesses] = await Promise.all([
      Place.find({
        $or: [
          { name: searchRegex },
          { address: searchRegex },
          { country: searchRegex },
        ],
      }).select('_id').lean(),
      Business.find({
        $or: [
          { name: searchRegex },
          { 'location.address': searchRegex },
          { 'location.city': searchRegex },
          { 'location.country': searchRegex },
        ],
      }).select('_id').lean(),
    ])

    const placeIds = matchingPlaces.map(p => p._id)
    const businessIds = matchingBusinesses.map(b => b._id)

    const searchOr: any[] = [
      { title: searchRegex },
      { description: searchRegex },
    ]

    if (placeIds.length > 0) {
      searchOr.push({ place: { $in: placeIds } })
    }
    if (businessIds.length > 0) {
      searchOr.push({ business: { $in: businessIds } })
    }

    filterConditions.push({ $or: searchOr })
  }

  const finalFilter =
    filterConditions.length > 1
      ? { $and: filterConditions }
      : filterConditions[0]

  const offerQuery = new QueryBuilder(
    Offer.find(finalFilter)
      .populate({
        path: 'business',
        select: 'name location media status category map country',
        populate: { path: 'map', select: 'name country' },
      })
      .populate({
        path: 'place',
        select: 'name location media status category map country address',
        populate: { path: 'map', select: 'name country' },
      })
      .lean(),
    queryObj,
  )
    .filter()
    .sort()
    .paginate()
    .fields()

  // Concurrently run query, pagination, and user authentication
  const [user, rawData, meta] = await Promise.all([
    getUserFromToken(authHeader),
    offerQuery.modelQuery,
    offerQuery.getPaginationInfo(),
  ])

  const isPremium = user && (
    [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role as any)
  )

  const accessibleMapIds = await getAccessibleMapIds(user)

  const countries = rawData
    .map((offer: any) => offer.business?.location?.country || offer.business?.country)
    .filter(Boolean)
  const countryLookup = await buildCountryToMapIdLookup(countries)

  const updatedData = rawData.map((offer: any) => {
    const placeMapId = resolveOfferMapId(offer, countryLookup)
    const isLocked = !isPremium && (!placeMapId || !accessibleMapIds.includes(placeMapId))
    if (isLocked) {
      return sanitizeLockedOffer({ ...offer, isLocked: true })
    }
    return {
      ...offer,
      isLocked: false,
    }
  })

  return {
    meta,
    data: updatedData,
  }
}

export const getOfferRecurrenceWindowMs = (offer: any): number | null => {
  const freq = String(offer?.redemptionFrequency || '').toLowerCase()
  if (freq === 'once') return null
  if (freq === 'daily') return 24 * 60 * 60 * 1000
  if (freq === 'weekly') return 7 * 24 * 60 * 60 * 1000
  if (freq === 'monthly') return 30 * 24 * 60 * 60 * 1000

  const duration = Number(offer?.redemptionDuration) || 0
  if (duration >= 525600) return null // 1 year / once
  if (duration === 1440) return 24 * 60 * 60 * 1000
  if (duration === 10080) return 7 * 24 * 60 * 60 * 1000
  if (duration === 43200) return 30 * 24 * 60 * 60 * 1000
  if (duration > 0 && duration < 525600) return duration * 60 * 1000

  return 24 * 60 * 60 * 1000 // Default to daily (24 hours) for recurring offers
}

const getOfferById = async (id: string, authHeader?: string): Promise<any> => {
  const [user, rawResult] = await Promise.all([
    getUserFromToken(authHeader),
    Offer.findById(id)
      .populate({
        path: 'place',
        select: 'name location media status category map country address',
        populate: { path: 'map', select: 'name country' },
      })
      .populate({
        path: 'business',
        select: 'name location media status category map country',
        populate: { path: 'map', select: 'name country' },
      }),
  ])

  if (!rawResult) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Offer not found')
  }

  const isPremium = user && (
    [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role as any)
  )

  if (!isPremium) {
    const accessibleMapIds = await getAccessibleMapIds(user)
    const placeMapId = await resolveOfferMapIdAsync(rawResult)
    if (!placeMapId || !accessibleMapIds.includes(placeMapId)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'This information and these benefits can be unlocked by purchasing your favorite map.',
      )
    }
  }

  let result: any = rawResult
  if (user) {
    const recurrenceWindowMs = getOfferRecurrenceWindowMs(rawResult)
    const redemptionFilter: any = {
      user: user._id,
      offer: id,
    }

    if (recurrenceWindowMs !== null) {
      const windowStart = new Date(Date.now() - recurrenceWindowMs)
      redemptionFilter.$or = [
        { createdAt: { $gte: windowStart } },
        { redemptionTime: { $gte: windowStart } },
      ]
    }

    const [activeRedemption, userRedemptionCount] = await Promise.all([
      OfferRedemption.findOne({
        user: user._id,
        offer: id,
        expiresAt: { $gt: new Date() },
      }),
      OfferRedemption.countDocuments(redemptionFilter),
    ])

    let nextAvailableAt: Date | null = null
    const maxRedemptions = rawResult.maxRedemptions || 1
    if (recurrenceWindowMs !== null && userRedemptionCount >= maxRedemptions) {
      const oldestInWindow = await OfferRedemption.findOne(redemptionFilter).sort({
        createdAt: 1,
        redemptionTime: 1,
      })
      const oldestTime = oldestInWindow?.createdAt || oldestInWindow?.redemptionTime
      if (oldestTime) {
        nextAvailableAt = new Date(new Date(oldestTime).getTime() + recurrenceWindowMs)
      }
    }

    const offerObj = typeof result.toObject === 'function' ? result.toObject() : result
    result = {
      ...offerObj,
      activeRedemption,
      userRedemptionCount,
      isRecurring: recurrenceWindowMs !== null,
      recurrenceWindowMs,
      nextAvailableAt,
    }
  }

  return result
}

const updateOffer = async (
  id: string,
  payload: any,
  authHeader?: string,
): Promise<IOffer | null> => {
  const existingOffer = await Offer.findById(id)
  if (!existingOffer) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Offer not found')
  }

  const { images, ...offerData } = payload
  const user = await getUserFromToken(authHeader)

  // getOfferById / raw model populates place/business — always resolve raw ids
  const existingPlaceId =
    (existingOffer as any).place?._id?.toString() ||
    (existingOffer as any).place?.toString() ||
    null
  const existingBusinessId =
    (existingOffer as any).business?._id?.toString() ||
    (existingOffer as any).business?.toString() ||
    null

  if (user && user.role === USER_ROLES.USER) {
    await assertUserOwnsBusiness(user, existingBusinessId || offerData.business)
    delete offerData.business
    delete offerData.place
  }

  if (user && user.role === USER_ROLES.MAP_EDITOR) {
    // Check existing offer's place/business
    if (existingPlaceId) {
      const place = await Place.findById(existingPlaceId)
      if (place) {
        const mapId = place.map?._id || place.map
        if (mapId) {
          await verifyEditorEditAccess(user, mapId.toString())
        }
      }
    } else if (existingBusinessId) {
      const business = await Business.findById(existingBusinessId)
      if (business) {
        await verifyEditorBusinessAccess(user, business.location?.country)
      }
    }

    // Check new place/business if they are being updated
    if (offerData.place && offerData.place !== existingPlaceId) {
      const place = await Place.findById(offerData.place)
      if (place) {
        const mapId = place.map?._id || place.map
        if (mapId) {
          await verifyEditorEditAccess(user, mapId.toString())
        }
      }
    } else if (offerData.business && offerData.business !== existingBusinessId) {
      const business = await Business.findById(offerData.business)
      if (business) {
        await verifyEditorBusinessAccess(user, business.location?.country)
      }
    }
  }

  // Handle image upload from disk storage
  if (images) {
    offerData.photo = Array.isArray(images) ? images[0] : images
  }

  await processOfferTranslations(offerData)

  const targetStatus = offerData.status || existingOffer.status
  const targetPlace = offerData.place || existingOffer.place
  const targetBusiness = offerData.business || existingOffer.business

  if (offerData.discountType === DISCOUNT_TYPE.BOGO && !offerData.bogoSecondType) {
    offerData.bogoSecondType = existingOffer.bogoSecondType || BOGO_SECOND_TYPE.FREE
  }

  if (targetStatus === OFFER_STATUS.ACTIVE && (targetPlace || targetBusiness)) {
    const query: any[] = []
    if (targetPlace) query.push({ place: targetPlace })
    if (targetBusiness) query.push({ business: targetBusiness })

    if (query.length > 0) {
      const existingActiveOffer = await Offer.findOne({
        _id: { $ne: id },
        $or: query,
        status: OFFER_STATUS.ACTIVE,
      })

      if (existingActiveOffer) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'An active offer already exists for this place or business',
        )
      }
    }
  }

  const result = await Offer.findByIdAndUpdate(id, offerData, {
    new: true,
    runValidators: true,
  }).populate('place')

  if (
    existingOffer.status !== OFFER_STATUS.ACTIVE &&
    result &&
    result.status === OFFER_STATUS.ACTIVE
  ) {
    NotificationIntegration.onNewOffer(result).catch(err =>
      console.error('Failed to dispatch new offer notification:', err),
    )
  }

  return result
}

const getOffersByPlaceOrBusinessId = async (id: string, authHeader?: string) => {
  const [user, result] = await Promise.all([
    getUserFromToken(authHeader),
    Offer.findOne({
      $or: [{ place: id }, { business: id }],
    }).populate('place business'),
  ])

  const isPremium = user && (
    [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role as any)
  )

  let offerObj: any = null
  if (result) {
    offerObj = typeof (result as any).toObject === 'function' ? (result as any).toObject() : result
    const actualRedemptionsCount = await OfferRedemption.countDocuments({ offer: offerObj._id })
    offerObj.redemptionsCount = Math.max(Number(offerObj.redemptionsCount) || 0, actualRedemptionsCount)
    const accessibleMapIds = await getAccessibleMapIds(user)
    const placeMapId = await resolveOfferMapIdAsync(offerObj)
    offerObj.isLocked = !isPremium && (!placeMapId || !accessibleMapIds.includes(placeMapId))

    if (user) {
      const recurrenceWindowMs = getOfferRecurrenceWindowMs(offerObj)
      const redemptionFilter: any = {
        user: user._id,
        offer: offerObj._id,
      }

      if (recurrenceWindowMs !== null) {
        const windowStart = new Date(Date.now() - recurrenceWindowMs)
        redemptionFilter.$or = [
          { createdAt: { $gte: windowStart } },
          { redemptionTime: { $gte: windowStart } },
        ]
      }

      const [activeRedemption, userRedemptionCount] = await Promise.all([
        OfferRedemption.findOne({
          user: user._id,
          offer: offerObj._id,
          expiresAt: { $gt: new Date() },
        }),
        OfferRedemption.countDocuments(redemptionFilter),
      ])

      let nextAvailableAt: Date | null = null
      const maxRedemptions = offerObj.maxRedemptions || 1
      if (recurrenceWindowMs !== null && userRedemptionCount >= maxRedemptions) {
        const oldestInWindow = await OfferRedemption.findOne(redemptionFilter).sort({
          createdAt: 1,
          redemptionTime: 1,
        })
        const oldestTime = oldestInWindow?.createdAt || oldestInWindow?.redemptionTime
        if (oldestTime) {
          nextAvailableAt = new Date(new Date(oldestTime).getTime() + recurrenceWindowMs)
        }
      }

      offerObj.activeRedemption = activeRedemption
      offerObj.userRedemptionCount = userRedemptionCount
      offerObj.isRecurring = recurrenceWindowMs !== null
      offerObj.recurrenceWindowMs = recurrenceWindowMs
      offerObj.nextAvailableAt = nextAvailableAt
    }
  }

  return offerObj
}

const getOfferRedemptions = async (
  id: string,
  authHeader?: string,
  timeFilter?: string,
) => {
  const [user, offer] = await Promise.all([
    getUserFromToken(authHeader),
    Offer.findOne({
      $or: [
        ...(Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
        { place: id },
        { business: id },
      ],
    }).lean(),
  ])

  if (!offer) {
    return { count: 0, redemptions: [] }
  }

  const dateRange = getTimeFilterQuery(timeFilter)
  const redemptQuery: any = { offer: offer._id }
  if (dateRange) {
    redemptQuery.createdAt = dateRange
  }

  const [actualCount, redemptions] = await Promise.all([
    OfferRedemption.countDocuments(redemptQuery),
    OfferRedemption.find(redemptQuery)
      .populate('user', 'name profile.avatar profile.photo email')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ])

  return {
    count: dateRange
      ? actualCount
      : Math.max(actualCount, Number(offer.redemptionsCount) || 0),
    redemptions,
    timeFilter: timeFilter || 'all_time',
  }
}


const deleteOffer = async (id: string): Promise<IOffer | null> => {
  const isExist = await Offer.findById(id)
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Offer not found')
  }
  const result = await Offer.findByIdAndDelete(id)
  return result
}

const calculateDiscount = async (id: string, price: number, authHeader?: string) => {
  if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Valid price must be provided')
  }

  const [user, offer] = await Promise.all([
    getUserFromToken(authHeader),
    Offer.findById(id),
  ])

  if (!offer) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Offer not found')
  }

  const isPremium = user && (
    [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role as any)
  )

  if (!isPremium) {
    const accessibleMapIds = await getAccessibleMapIds(user)
    const placeMapId = await resolveOfferMapIdAsync(offer)
    if (!placeMapId || !accessibleMapIds.includes(placeMapId)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'This information and these benefits can be unlocked by purchasing your favorite map.',
      )
    }
  }

  let discountAmount = 0
  if (offer.discountType === DISCOUNT_TYPE.PERCENTAGE) {
    const percentage = Number(offer.discountValue)
    if (!isNaN(percentage)) discountAmount = (price * percentage) / 100
  } else if (offer.discountType === DISCOUNT_TYPE.FLAT) {
    const flat = Number(offer.discountValue)
    if (!isNaN(flat)) discountAmount = flat > price ? price : flat
  }

  const finalPrice = Math.max(0, price - discountAmount)
  return { originalPrice: price, discountAmount, finalPrice }
}

const redeemOffer = async (id: string, userId: string, authHeader?: string) => {
  const [user, offer] = await Promise.all([
    getUserFromToken(authHeader),
    Offer.findById(id),
  ])

  if (!offer) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Offer not found')
  }

  const isPremium = user && (
    [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.MAP_EDITOR].includes(user.role as any)
  )

  if (!isPremium) {
    const accessibleMapIds = await getAccessibleMapIds(user)
    const placeMapId = await resolveOfferMapIdAsync(offer)
    if (!placeMapId || !accessibleMapIds.includes(placeMapId)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'This information and these benefits can be unlocked by purchasing your favorite map.',
      )
    }
  }

  if (offer.status !== OFFER_STATUS.ACTIVE) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Offer is not active')
  }

  // Optional cap across every user
  if (
    offer.totalRedemptionLimit &&
    offer.redemptionsCount >= offer.totalRedemptionLimit
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Offer redemption limit reached',
    )
  }

  // maxRedemptions is evaluated within the recurrence window (e.g. daily = 24 hours)
  if (offer.maxRedemptions) {
    const recurrenceWindowMs = getOfferRecurrenceWindowMs(offer)
    let userRedemptionsQuery: any = {
      user: userId,
      offer: id,
    }

    if (recurrenceWindowMs !== null) {
      const windowStart = new Date(Date.now() - recurrenceWindowMs)
      userRedemptionsQuery = {
        user: userId,
        offer: id,
        $or: [
          { createdAt: { $gte: windowStart } },
          { redemptionTime: { $gte: windowStart } },
        ],
      }
    }

    const userRedemptions = await OfferRedemption.countDocuments(userRedemptionsQuery)
    if (userRedemptions >= offer.maxRedemptions) {
      const freq = String(offer.redemptionFrequency || '').toLowerCase()
      const freqLabel =
        freq === 'daily' || recurrenceWindowMs === 24 * 60 * 60 * 1000
          ? 'today'
          : freq === 'weekly' || recurrenceWindowMs === 7 * 24 * 60 * 60 * 1000
            ? 'this week'
            : freq === 'monthly' || recurrenceWindowMs === 30 * 24 * 60 * 60 * 1000
              ? 'this month'
              : ''

      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        offer.maxRedemptions === 1
          ? `You have already redeemed this offer${freqLabel ? ` ${freqLabel}` : ''}`
          : `You can redeem this offer only ${offer.maxRedemptions} times${freqLabel ? ` ${freqLabel}` : ''}`,
      )
    }
  }

  // Check expiration date
  const now = new Date()
  if (offer.noExpiration !== true) {
    if (offer.validFrom && now < new Date(offer.validFrom)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Offer is not yet valid')
    }
    if (offer.validUntil && now > new Date(offer.validUntil)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Offer has expired')
    }
  }

  // Check if there is an active redemption (timer still running)
  const activeRedemption = await OfferRedemption.findOne({
    user: userId,
    offer: id,
    expiresAt: { $gt: new Date() },
  })

  if (activeRedemption) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You already have an active redemption for this offer',
    )
  }

  // Active session countdown timer for customer to show staff (configured by admin on offer, default 15 mins)
  const durationInMinutes =
    Number(offer.redemptionDuration) && Number(offer.redemptionDuration) > 0
      ? Number(offer.redemptionDuration)
      : 15
  const expiresAt = new Date(Date.now() + durationInMinutes * 60 * 1000)

  const redemption = await OfferRedemption.create({
    user: userId,
    offer: id,
    redemptionTime: new Date(),
    expiresAt,
  })

  // Increment redemption count
  await Offer.findByIdAndUpdate(id, { $inc: { redemptionsCount: 1 } })

  return redemption
}

export const OfferService = {
  createOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
  calculateDiscount,
  redeemOffer,
  getOffersByPlaceOrBusinessId,
  getOfferRedemptions,
}

