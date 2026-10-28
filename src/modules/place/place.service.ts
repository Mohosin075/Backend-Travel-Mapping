import { StatusCodes } from 'http-status-codes'
import ApiError from '../../errors/ApiError'
import { IPlace } from './place.interface'
import { Place } from './place.model'
import { Map } from '../map/map.model'
import { Category } from '../category/category.model'
import mongoose from 'mongoose'
import { getCountryFromCoordinates } from '../../utils/reverseGeocoding'
import { Business } from '../business/business.model'
import { autoTranslateField } from '../../utils/autoTranslate'
import { NotificationIntegration } from '../notification/notification.integration'
import { Visited } from '../visited/visited.model'
import { User } from '../user/user.model'
import { USER_ROLES } from '../../enum/user'
import { USER_LEVELS, calculateUserLevel } from '../../constants/userLevels.constant'
import { LevelConfigServices } from '../award/levelConfig.service'
import { NotificationServices } from '../notification/notification.service'
import {
  NotificationType,
  NotificationCategory,
  NotificationPriority,
} from '../notification/notification.interface'
import { IPaginationOptions } from '../../interfaces/pagination'
import { paginationHelper } from '../../helpers/paginationHelper'

const resolveTranslatableField = async (
  newVal: any,
  existingVal: any
): Promise<any> => {
  if (newVal === undefined || newVal === null) return newVal

  // If existingVal already has translations { en, es }
  if (existingVal && typeof existingVal === 'object') {
    const exEn = typeof existingVal.en === 'string' ? existingVal.en.trim() : ''
    const exEs = typeof existingVal.es === 'string' ? existingVal.es.trim() : ''

    // If newVal is a string matching either the existing English or Spanish text,
    // the user did not change the meaning — keep the existing translations without API calls!
    if (typeof newVal === 'string') {
      const cleanNew = newVal.trim()
      if (cleanNew && (cleanNew === exEn || cleanNew === exEs)) {
        return { en: exEn, es: exEs }
      }
    } else if (typeof newVal === 'object') {
      const newEn = typeof newVal.en === 'string' ? newVal.en.trim() : ''
      const newEs = typeof newVal.es === 'string' ? newVal.es.trim() : ''
      if (newEn && newEs && newEn === exEn && newEs === exEs) {
        return { en: exEn, es: exEs }
      }
    }
  }

  // If newVal already has non-empty en and es values
  if (
    typeof newVal === 'object' &&
    newVal !== null &&
    newVal.en &&
    newVal.es
  ) {
    return { en: String(newVal.en).trim(), es: String(newVal.es).trim() }
  }

  return await autoTranslateField(newVal)
}

const processPlaceTranslations = async (
  payload: Partial<IPlace>,
  existingDoc?: any
) => {
  const tasks: Promise<void>[] = []

  if (payload.name) {
    tasks.push(
      (async () => {
        if (typeof payload.name === 'string') {
          const trimmed = payload.name.trim()
          payload.name = { en: trimmed, es: trimmed }
        } else if (typeof payload.name === 'object' && payload.name !== null) {
          const enVal = (payload.name.en || '').trim()
          const esVal = (payload.name.es || '').trim()
          if (enVal && esVal) {
            payload.name = { en: enVal, es: esVal }
          } else {
            const fallback =
              enVal ||
              esVal ||
              (typeof existingDoc?.name === 'string'
                ? existingDoc.name
                : existingDoc?.name?.en || existingDoc?.name?.es || '')
            payload.name = { en: enVal || fallback, es: esVal || fallback }
          }
        }
      })()
    )
  }
  if (payload.description) {
    tasks.push(
      (async () => {
        payload.description = await resolveTranslatableField(
          payload.description,
          existingDoc?.description
        )
      })()
    )
  }
  if (payload.access) {
    tasks.push(
      (async () => {
        payload.access = await resolveTranslatableField(payload.access, existingDoc?.access)
      })()
    )
  }
  if (payload.entryCost) {
    tasks.push(
      (async () => {
        payload.entryCost = await resolveTranslatableField(
          payload.entryCost,
          existingDoc?.entryCost
        )
      })()
    )
  }
  if (payload.difficulty) {
    tasks.push(
      (async () => {
        payload.difficulty = await resolveTranslatableField(
          payload.difficulty,
          existingDoc?.difficulty
        )
      })()
    )
  }
  if (payload.hikeTime) {
    tasks.push(
      (async () => {
        payload.hikeTime = await resolveTranslatableField(
          payload.hikeTime,
          existingDoc?.hikeTime
        )
      })()
    )
  }
  if (payload.atmosphere) {
    tasks.push(
      (async () => {
        payload.atmosphere = await resolveTranslatableField(
          payload.atmosphere,
          existingDoc?.atmosphere
        )
      })()
    )
  }
  if (payload.accessibility?.notes) {
    tasks.push(
      (async () => {
        payload.accessibility!.notes = await resolveTranslatableField(
          payload.accessibility!.notes,
          existingDoc?.accessibility?.notes
        )
      })()
    )
  }
  if (payload.recommendations?.tips) {
    tasks.push(
      (async () => {
        payload.recommendations!.tips = await resolveTranslatableField(
          payload.recommendations!.tips,
          existingDoc?.recommendations?.tips
        )
      })()
    )
  }

  await Promise.all(tasks)
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function buildAccentInsensitivePattern(term: string): string {
  if (!term) return ''
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped
    .replace(/\s+/g, '\\s+')
    .replace(/[aáàâäãåAÁÀÂÄÃÅ]/g, '[aáàâäãåAÁÀÂÄÃÅ]')
    .replace(/[eéèêëEÉÈÊË]/g, '[eéèêëEÉÈÊË]')
    .replace(/[iíìîïIÍÌÎÏ]/g, '[iíìîïIÍÌÎÏ]')
    .replace(/[oóòôöõOÓÒÔÖÕ]/g, '[oóòôöõOÓÒÔÖÕ]')
    .replace(/[uúüùûUÚÜÙÛ]/g, '[uúüùûUÚÜÙÛ]')
    .replace(/[nñNÑ]/g, '[nñNÑ]')
}

const toNumber = (value: unknown): number => {
  const parsed =
    typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : NaN
}

const createPlace = async (payload: IPlace): Promise<IPlace> => {
  await processPlaceTranslations(payload)

  // 1. Resolve map and align country to designated map (prevents incorrect country when adding places)
  let map: any = null
  if (payload.map) {
    map = await Map.findById(payload.map)
    if (!map) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found')
    }
    const mapCountry =
      map.country ||
      (typeof map.name === 'object' && map.name !== null
        ? (map.name as any).en || (map.name as any).es || Object.values(map.name)[0]
        : map.name)
    if (mapCountry) {
      payload.country = String(mapCountry).trim()
    }
  }

  // 2. Fallback to reverse geocoding only if country is still completely missing
  if (!payload.country && payload.location?.coordinates) {
    const [lng, lat] = payload.location.coordinates
    const country = await getCountryFromCoordinates(lat, lng)
    if (country) {
      payload.country = country
    } else {
      payload.country = 'Roadtripeado'
    }
  }

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    // Ensure map exists within session
    const mapInSession = await Map.findById(payload.map).session(session)
    if (!mapInSession) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found')
    }

    const result = await Place.create([payload], { session })
    const createdPlace = result[0]

    // Add place to map (do not overwrite map.country if map already has a country)
    await Map.findByIdAndUpdate(
      payload.map,
      { 
        $push: { places: createdPlace._id },
        ...(mapInSession.country ? {} : { $set: { country: createdPlace.country } })
      },
      { session }
    )

    await session.commitTransaction()

    if (createdPlace.status === 'Published') {
      NotificationIntegration.onNewLocation(createdPlace).catch(err =>
        console.error('Failed to notify new location:', err),
      )
    }

    return createdPlace
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
}

const commonSearchSynonyms: Record<string, string[]> = {
  faro: ['lighthouse', 'faros', 'lighthouses'],
  faros: ['lighthouse', 'lighthouses', 'faro'],
  lighthouse: ['faro', 'faros', 'lighthouses'],
  lighthouses: ['faro', 'faros', 'lighthouse'],
  playa: ['beach', 'playas', 'beaches'],
  playas: ['beach', 'beaches', 'playa'],
  beach: ['playa', 'playas', 'beaches'],
  beaches: ['playa', 'playas', 'beach'],
  ruinas: ['ruins', 'ruina', 'ruin'],
  ruins: ['ruinas', 'ruina', 'ruin'],
  cascada: ['waterfall', 'cascadas', 'waterfalls'],
  waterfall: ['cascada', 'cascadas', 'waterfalls'],
  cueva: ['cave', 'cuevas', 'caves'],
  cave: ['cueva', 'cuevas', 'caves'],
  castillo: ['castle', 'castillos', 'castles', 'fort', 'fortress'],
  castillos: ['castillo', 'castle', 'castles'],
  castle: ['castillo', 'castillos', 'castles', 'fort'],
  castles: ['castillo', 'castle', 'castillos'],
  tunel: ['tunnel', 'tuneles', 'tunnels'],
  tunnel: ['tunel', 'tunnels', 'tuneles'],
  puente: ['bridge', 'puentes', 'bridges'],
  bridge: ['puente', 'bridges', 'puentes'],
  rio: ['river', 'rios', 'rivers'],
  river: ['rio', 'rivers', 'rios'],
  charco: ['pond', 'pool', 'charcos'],
  mirador: ['viewpoint', 'lookout', 'miradores'],
  viewpoint: ['mirador', 'miradores'],
  bosque: ['forest', 'bosques', 'forests'],
  forest: ['bosque', 'forests', 'bosques'],
  isla: ['island', 'islas', 'islands'],
  island: ['isla', 'islands', 'islas'],
  bahia: ['bay', 'bahias', 'bays'],
  bay: ['bahia', 'bays', 'bahias'],
  laguna: ['lagoon', 'lagunas', 'lagoons'],
  lagoon: ['laguna', 'lagoons', 'lagunas'],
  museo: ['museum', 'museos', 'museums'],
  museum: ['museo', 'museums', 'museos'],
  restaurante: ['restaurant', 'restaurantes', 'restaurants'],
  restaurant: ['restaurante', 'restaurants', 'restaurantes'],
  hotel: ['hotel', 'hoteles', 'hotels'],
  hotels: ['hotel', 'hoteles'],
}

function buildPlaceSearchFilter(searchTerm: string, isBusiness = false) {
  const clean = searchTerm
    .trim()
    .toLowerCase()
    .replace(/[,;:.!?]/g, ' ')
    .replace(/\s+/g, ' ')
  if (!clean) return null

  const stopWords = [
    'los',
    'las',
    'del',
    'the',
    'and',
    'con',
    'para',
    'de',
    'en',
    'el',
    'la',
    'pr',
    'puerto',
    'rico',
  ]
  const words = clean
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.includes(w))

  const phraseRegex = new RegExp(buildAccentInsensitivePattern(clean), 'i')

  const getFields = (regex: RegExp) => {
    if (isBusiness) {
      return [
        { name: regex },
        { 'name.en': regex },
        { 'name.es': regex },
        { 'location.address': regex },
        { 'location.address.en': regex },
        { 'location.address.es': regex },
        { 'location.city': regex },
      ]
    }
    return [
      { name: regex },
      { 'name.en': regex },
      { 'name.es': regex },
      { address: regex },
      { 'address.en': regex },
      { 'address.es': regex },
      { 'location.city': regex },
      { 'location.address': regex },
    ]
  }

  // Single word: match term or synonyms
  if (words.length <= 1) {
    const termToUse = words[0] || clean
    const terms = [termToUse]
    if (commonSearchSynonyms[termToUse]) {
      terms.push(...commonSearchSynonyms[termToUse])
    }
    const singleRegex = new RegExp(
      terms.map(t => buildAccentInsensitivePattern(t)).join('|'),
      'i'
    )
    return { $or: getFields(singleRegex) }
  }

  // Multi-word search (e.g. "San Sebastian", "Cabo Rojo", "Cascada Gozalandia"):
  // Either exact phrase in any field, OR each significant word must be found across the place's fields
  const wordAndConditions = words.map(w => {
    const wRegex = new RegExp(buildAccentInsensitivePattern(w), 'i')
    return { $or: getFields(wRegex) }
  })

  return {
    $or: [
      { $or: getFields(phraseRegex) },
      { $and: wordAndConditions },
    ],
  }
}

const getAllPlaces = async (
  query: Record<string, unknown>,
  isAdminOrEditor = false,
  accessibleMapIds: string[] = [],
) => {
  const searchTerm =
    typeof query.searchTerm === 'string' ? query.searchTerm.trim() : ''
  const lat = toNumber(query.lat)
  const lng = toNumber(query.lng)
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng)
  const sort =
    typeof query.sort === 'string' && query.sort.trim()
      ? query.sort.trim()
      : '-createdAt'
  const limit = Number(query.limit) || 10
  const page = Number(query.page) || 1
  const skip = (page - 1) * limit

  const match: Record<string, unknown> = {}

  for (const key of ['map', 'country', 'category', 'type'] as const) {
    const value = query[key]
    if (typeof value === 'string' && value.trim() && value !== 'undefined') {
      match[key] = value.includes(',') ? { $in: value.split(',') } : value
    }
  }

  // Handle status filter: non-admins only ever see Published places
  if (!isAdminOrEditor) {
    match.status = 'Published'
  } else if (
    typeof query.status === 'string' &&
    query.status.trim() &&
    query.status !== 'undefined' &&
    query.status !== 'all'
  ) {
    match.status = query.status.includes(',')
      ? { $in: query.status.split(',') }
      : query.status
  } else if (
    typeof query.excludeStatus === 'string' &&
    query.excludeStatus.trim()
  ) {
    const excluded = query.excludeStatus.trim().split(',').map(s => s.trim())
    match.status = excluded.length > 1 ? { $nin: excluded } : { $ne: excluded[0] }
  }

  if (searchTerm) {
    const searchFilter = buildPlaceSearchFilter(searchTerm, false)
    if (searchFilter) {
      Object.assign(match, searchFilter)
    }
  }

  // Apply access before deduplication and pagination so locked search hits cannot
  // reveal names or displace accessible results. Unfiltered map teasers are unchanged.
  if (searchTerm && !isAdminOrEditor) {
    match.$and = [{ map: { $in: accessibleMapIds } }]
  }

  // 1. Fetch regular places if applicable
  const queryType = query.type as string | undefined
  const shouldQueryPlaces = !queryType || queryType === 'Regular' || queryType.includes('Regular')
  
  let places: any[] = []
  if (shouldQueryPlaces) {
    let placeQuery = Place.find(
      hasGeo
        ? {
            ...match,
            location: {
              $nearSphere: {
                $geometry: { type: 'Point', coordinates: [lng, lat] },
              },
            },
          }
        : match,
    )
      .populate('category', 'name color icon status')
      .populate('map', 'name country status isPaid')
      .populate('discoveredBy', 'name profile level')
      .lean()

    if (!hasGeo) {
      placeQuery = placeQuery.sort(sort)
    }

    places = await placeQuery
  }

  const formattedPlaces = places.map(p => ({
    ...p,
    _id: p._id.toString(),
  }))

  // 2. Fetch businesses if applicable
  const shouldQueryBusinesses = !queryType || queryType === 'Business' || queryType.includes('Business')
  let formattedBusinesses: any[] = []

  if (shouldQueryBusinesses) {
    const businessMatch: Record<string, any> = {}

    if (match.category) {
      businessMatch.category = match.category
    }

    if (match.country) {
      businessMatch['location.country'] = match.country
    } else if (match.map) {
      if (typeof match.map === 'object' && match.map !== null && '$in' in match.map) {
        const mapObjs = await Map.find({ _id: match.map }).select('name country').lean()
        businessMatch['location.country'] = { $in: mapObjs.map(m => m.country || m.name) }
      } else {
        const mapObj = await Map.findById(match.map).select('name country').lean()
        if (mapObj) {
          businessMatch['location.country'] = mapObj.country || mapObj.name
        }
      }
    }

    if (match.status) {
      if (typeof match.status === 'object' && match.status !== null && '$in' in match.status) {
        const statusObj = match.status as any
        const statuses = statusObj.$in.map((s: string) => {
          if (s === 'Published') return 'Approved'
          if (s === 'Draft') return 'Pending'
          return s
        })
        businessMatch.status = { $in: statuses }
      } else {
        const statusStr = match.status as string
        if (statusStr === 'Published') {
          businessMatch.status = 'Approved'
        } else if (statusStr === 'Draft') {
          businessMatch.status = 'Pending'
        } else {
          businessMatch.status = statusStr
        }
      }
    }

    if (searchTerm) {
      const searchFilter = buildPlaceSearchFilter(searchTerm, true)
      if (searchFilter) {
        Object.assign(businessMatch, searchFilter)
      }
    }

    let businessQuery = Business.find(
      hasGeo
        ? {
            ...businessMatch,
            'location.mapLocation': {
              $nearSphere: {
                $geometry: { type: 'Point', coordinates: [lng, lat] },
              },
            },
          }
        : businessMatch,
    )
      .populate('category', 'name color icon status')
      .lean()

    if (!hasGeo) {
      businessQuery = businessQuery.sort(sort)
    }

    const businesses = await businessQuery

    formattedBusinesses = businesses.map(business => {
      let placeStatus = 'Draft'
      if (business.status === 'Approved') placeStatus = 'Published'
      else if (business.status === 'Pending') placeStatus = 'Draft'
      else placeStatus = business.status

      return {
        ...business,
        _id: business._id.toString(),
        type: 'Business',
        placeType: 'Business',
        status: placeStatus,
        media: business.media?.photos || [],
        menuImages: business.media?.menu ? [business.media.menu] : [],
        address: business.location?.address || '',
        country: business.location?.country || '',
        location: {
          type: 'Point',
          coordinates: business.location?.mapLocation?.coordinates || [],
        },
        map: { name: business.location?.country },
      }
    })
  }

  // 3. Deduplicate and combine results (Issue 6: Prevent duplicate location records like Bai Picnic)
  const getAllNormalizedNames = (item: any): string[] => {
    const names: string[] = []
    const norm = (s: any) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()

    if (typeof item?.name === 'string') {
      names.push(norm(item.name))
    } else if (item?.name && typeof item.name === 'object') {
      if (item.name.en) names.push(norm(item.name.en))
      if (item.name.es) names.push(norm(item.name.es))
      for (const val of Object.values(item.name)) {
        if (typeof val === 'string') names.push(norm(val))
      }
    }
    return Array.from(new Set(names.filter(Boolean)))
  }

  const getCoordsKey = (item: any): string | null => {
    const coords =
      item?.location?.coordinates ||
      item?.location?.mapLocation?.coordinates ||
      item?.coordinates
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0])
      const lat = Number(coords[1])
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        return `${lng.toFixed(4)},${lat.toFixed(4)}`
      }
    }
    return null
  }

  const businessNameSet = new Set<string>()
  const businessCoordSet = new Set<string>()
  const deduplicatedBusinesses: any[] = []

  for (const b of formattedBusinesses) {
    const bNames = getAllNormalizedNames(b)
    const coordKey = getCoordsKey(b)

    if (bNames.some(n => businessNameSet.has(n))) continue
    if (coordKey && businessCoordSet.has(coordKey) && bNames.length > 0) continue

    bNames.forEach(n => businessNameSet.add(n))
    if (coordKey) businessCoordSet.add(coordKey)
    deduplicatedBusinesses.push(b)
  }

  const placeNameSet = new Set<string>()
  const placeCoordSet = new Set<string>()
  const deduplicatedPlaces: any[] = []

  for (const p of formattedPlaces) {
    const pNames = getAllNormalizedNames(p)
    const coordKey = getCoordsKey(p)

    // Check if this place matches an existing registered Business (by name or coords + similarity)
    const matchesBusinessByName = pNames.some(n => businessNameSet.has(n))
    const matchesBusinessByCoord =
      Boolean(coordKey &&
      businessCoordSet.has(coordKey) &&
      deduplicatedBusinesses.some(b => {
        const bNames = getAllNormalizedNames(b)
        return bNames.some(bn => pNames.some(pn => pn.includes(bn) || bn.includes(pn)))
      }))

    if (matchesBusinessByName || matchesBusinessByCoord) {
      const matchingBusiness = deduplicatedBusinesses.find(b => {
        const bNames = getAllNormalizedNames(b)
        return (
          bNames.some(bn => pNames.includes(bn)) ||
          (coordKey && getCoordsKey(b) === coordKey)
        )
      })
      if (matchingBusiness) {
        if (!matchingBusiness.category && p.category) matchingBusiness.category = p.category
        if (!matchingBusiness.map && p.map) matchingBusiness.map = p.map
      }
      continue
    }

    if (pNames.some(n => placeNameSet.has(n))) continue
    if (coordKey && placeCoordSet.has(coordKey) && pNames.length > 0) continue

    pNames.forEach(n => placeNameSet.add(n))
    if (coordKey) placeCoordSet.add(coordKey)
    deduplicatedPlaces.push(p)
  }

  let combined = [...deduplicatedPlaces, ...deduplicatedBusinesses]

  // Filter and sort combined results
  if (searchTerm) {
    const stripAccents = (str: string) =>
      (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[,;:.!?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const cleanSearch = stripAccents(searchTerm)
    const stopWords = [
      'los',
      'las',
      'del',
      'the',
      'and',
      'con',
      'para',
      'de',
      'en',
      'el',
      'la',
      'pr',
      'puerto',
      'rico',
    ]
    const wordsClean = cleanSearch
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.includes(w))
    const mainPhrase = wordsClean.join(' ')

    const getScore = (p: any) => {
      let score = 0
      const nameEn = stripAccents(p.name?.en || (typeof p.name === 'string' ? p.name : ''))
      const nameEs = stripAccents(p.name?.es || (typeof p.name === 'string' ? p.name : ''))
      const addrEn = stripAccents(p.address?.en || p.address || p.location?.address || p.location?.city || '')
      const addrEs = stripAccents(p.address?.es || p.address || p.location?.address || p.location?.city || '')

      const nameText = `${nameEn} ${nameEs}`.trim()
      const addrText = `${addrEn} ${addrEs}`.trim()
      const fullText = `${nameText} ${addrText}`.trim()

      // Exact phrase match
      if (
        nameText.startsWith(cleanSearch) ||
        (mainPhrase && nameText.startsWith(mainPhrase))
      ) {
        score += 1000
      } else if (
        nameText.includes(cleanSearch) ||
        (mainPhrase && nameText.includes(mainPhrase))
      ) {
        score += 800
      }

      if (
        addrText.startsWith(cleanSearch) ||
        (mainPhrase && addrText.startsWith(mainPhrase))
      ) {
        score += 600
      } else if (
        addrText.includes(cleanSearch) ||
        (mainPhrase && addrText.includes(mainPhrase))
      ) {
        score += 500
      }

      // Multi-word search (e.g. "San Sebastian", "Cascada Gozalandia")
      if (wordsClean.length > 1) {
        if (score === 0) {
          const allWordsPresent = wordsClean.every(w => fullText.includes(w))
          if (allWordsPresent) {
            score += 350
          }
        }
      } else if (wordsClean.length === 1) {
        const single = wordsClean[0]
        if (score === 0) {
          if (nameText.startsWith(single)) score += 450
          else if (nameText.includes(single)) score += 400
          else if (addrText.startsWith(single)) score += 350
          else if (addrText.includes(single)) score += 300
          else {
            const syns = commonSearchSynonyms[single] || []
            for (const s of syns) {
              if (nameText.includes(s) || addrText.includes(s)) {
                score += 200
                break
              }
            }
          }
        }
      }

      return score
    }

    // Filter out places with 0 score (strictly keep actual matches only)
    combined = combined.filter((p: any) => getScore(p) > 0)

    if (!hasGeo) {
      combined.sort((a: any, b: any) => {
        const scoreDiff = getScore(b) - getScore(a)
        if (scoreDiff !== 0) return scoreDiff
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      })
    }
  } else if (!hasGeo) {
    const isDesc = sort.startsWith('-')
    const sortField = sort.replace('-', '')

    combined.sort((a: any, b: any) => {
      let valA = a[sortField]
      let valB = b[sortField]

      if (sortField === 'map') {
        valA = a.map?.name || ''
        valB = b.map?.name || ''
      } else if (sortField === 'category') {
        valA = a.category?.name || ''
        valB = b.category?.name || ''
      } else if (sortField === 'createdAt' || sortField === 'updatedAt') {
        valA = valA ? new Date(valA).getTime() : 0
        valB = valB ? new Date(valB).getTime() : 0
      }

      if (typeof valA === 'string') valA = valA.toLowerCase()
      if (typeof valB === 'string') valB = valB.toLowerCase()

      if (valA < valB) return isDesc ? 1 : -1
      if (valA > valB) return isDesc ? -1 : 1
      return 0
    })
  }

  const total = combined.length
  const paginatedData = combined.slice(skip, skip + limit)

  return {
    meta: {
      total,
      page,
      limit,
      totalPage: Math.ceil(total / limit) || 0,
    },
    data: paginatedData,
  }
}

const getPlaceById = async (id: string): Promise<any | null> => {
  const result = await Place.findById(id)
    .populate('category')
    .populate('map')
    .populate('discoveredBy', 'name profile level')
    .lean()
  if (result) return result

  // Fallback to checking Business collection
  const business = await Business.findById(id).populate('category').lean()
  if (business) {
    let placeStatus = 'Draft'
    if (business.status === 'Approved') placeStatus = 'Published'
    else if (business.status === 'Pending') placeStatus = 'Draft'
    else placeStatus = business.status

    // Map Business fields to Place schema so frontend doesn't break
    return {
      ...business,
      _id: business._id.toString(),
      type: 'Business',
      placeType: 'Business',
      status: placeStatus,
      media: (business.media?.photos || []).filter(Boolean),
      menuImages: business.media?.menu ? [business.media.menu] : [],
      address: business.location?.address || '',
      country: business.location?.country || '',
      location: {
        type: 'Point',
        coordinates: business.location?.mapLocation?.coordinates || [],
      },
      map: { name: business.location?.country },
      // Expose hours.schedule as operatingHours so edit form loads the saved data
      operatingHours: business.hours?.schedule || null,
      phone: business.contact?.phone || '',
      website: business.contact?.website || '',
      instagram: business.contact?.instagram || '',
    }
  }
  throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
}

const incrementOpenCount = async (id: string) => {
  const result = await Place.findByIdAndUpdate(
    id,
    { $inc: { openCount: 1 } },
    { new: true },
  ).select('name openCount')
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
  }
  return result
}

const updatePlace = async (
  id: string,
  payload: Partial<IPlace>,
): Promise<any | null> => {
  const isExist = await Place.findById(id)
  if (!isExist) {
    // Fallback: Check and update Business collection
    const isBusiness = await Business.findById(id)
    if (!isBusiness) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
    }
    await processPlaceTranslations(payload, isBusiness)

    // Map payload from Place structure back to Business schema format
    const businessPayload: any = {}
    if (payload.name) businessPayload.name = payload.name
    if (payload.category) businessPayload.category = payload.category
    if (payload.description) businessPayload.description = payload.description
    
    // Address & coordinates mapping
    if (payload.address || payload.location?.coordinates) {
      businessPayload.location = {
        ...(isBusiness.location || {}),
        ...(payload.address && { address: payload.address }),
        ...(payload.location?.coordinates && {
          mapLocation: {
            type: 'Point',
            coordinates: payload.location.coordinates,
          },
        }),
      }
    }

    // Media mapping
    if (payload.media) {
      businessPayload.media = {
        ...(isBusiness.media || {}),
        photos: payload.media,
      }
    }
    if (payload.menuImages && payload.menuImages.length > 0) {
      businessPayload.media = {
        ...(businessPayload.media || isBusiness.media || {}),
        menu: payload.menuImages[0], // Business schema holds a single string for menu
      }
    }

    // Phone, website, instagram
    if (payload.phone || payload.website || payload.instagram) {
      businessPayload.contact = {
        ...(isBusiness.contact || {}),
        ...(payload.phone && { phone: payload.phone }),
        ...(payload.website && { website: payload.website }),
        ...(payload.instagram && { instagram: payload.instagram }),
      }
    }

    // Hours / Schedule — support full operatingHours object { Monday: { open, close, closed } }
    if (payload.operatingHours && typeof payload.operatingHours === 'object') {
      // Merge with existing hours so we don't wipe unrelated fields
      businessPayload['hours.customHours'] = true
      businessPayload['hours.schedule'] = payload.operatingHours
    }

    // Status mapping for business
    if (payload.status) {
      if (payload.status === 'Published') businessPayload.status = 'Approved'
      else if (payload.status === 'Draft') businessPayload.status = 'Pending'
      else businessPayload.status = payload.status
    }

    const updatedBusiness = await Business.findByIdAndUpdate(id, businessPayload, {
      new: true,
      runValidators: true,
    }).populate('category')

    // Return mapped to Place schema format
    if (updatedBusiness) {
      let placeStatus = 'Draft'
      if (updatedBusiness.status === 'Approved') placeStatus = 'Published'
      else if (updatedBusiness.status === 'Pending') placeStatus = 'Draft'
      else placeStatus = updatedBusiness.status

      return {
        ...updatedBusiness.toObject(),
        type: 'Business',
        placeType: 'Business',
        status: placeStatus,
        media: (updatedBusiness.media?.photos || []).filter(Boolean),
        menuImages: updatedBusiness.media?.menu ? [updatedBusiness.media.menu] : [],
        address: updatedBusiness.location?.address || '',
        country: updatedBusiness.location?.country || '',
        location: {
          type: 'Point',
          coordinates: updatedBusiness.location?.mapLocation?.coordinates || [],
        },
        map: { name: updatedBusiness.location?.country },
      }
    }
    return null
  }

  await processPlaceTranslations(payload, isExist)

  const nextCoords = payload.location?.coordinates
  const prevCoords = isExist.location?.coordinates
  const COORD_EPSILON = 1e-6
  const coordsChanged =
    !!nextCoords &&
    (!prevCoords ||
      Math.abs(nextCoords[0] - prevCoords[0]) > COORD_EPSILON ||
      Math.abs(nextCoords[1] - prevCoords[1]) > COORD_EPSILON)

  // Only hit Google when the pin actually moved and no map country exists
  if (coordsChanged && !payload.country) {
    const targetMapId = payload.map || isExist.map
    if (targetMapId) {
      const targetMap = await Map.findById(targetMapId)
      const mapCountry =
        targetMap?.country ||
        (typeof targetMap?.name === 'object' && targetMap?.name !== null
          ? (targetMap.name as any).en || (targetMap.name as any).es
          : targetMap?.name)
      if (mapCountry) {
        payload.country = String(mapCountry).trim()
      }
    }
    if (!payload.country) {
      const [lng, lat] = nextCoords
      const country = await getCountryFromCoordinates(lat, lng)
      if (country) {
        payload.country = country
      }
    }
  }

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    // Handle map change
    if (payload.map && payload.map.toString() !== isExist.map.toString()) {
      // Remove from old map
      await Map.findByIdAndUpdate(
        isExist.map,
        { $pull: { places: isExist._id } },
        { session }
      )
      // Add to new map
      await Map.findByIdAndUpdate(
        payload.map,
        { $push: { places: isExist._id } },
        { session }
      )
    }

    const nextMedia = Array.isArray(payload.media)
      ? payload.media.filter(Boolean)
      : undefined
    if (nextMedia) {
      payload.media = nextMedia.length > 0 ? nextMedia : isExist.media
    }

    const nextMenu = Array.isArray(payload.menuImages)
      ? payload.menuImages.filter(Boolean)
      : undefined
    if (nextMenu) {
      payload.menuImages = nextMenu.length > 0 ? nextMenu : isExist.menuImages
    }

    const result = await Place.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
      session,
    })
      .populate('category')
      .populate('map')

    await session.commitTransaction()

    if (isExist.status !== 'Published' && result && result.status === 'Published') {
      NotificationIntegration.onNewLocation(result).catch(err =>
        console.error('Failed to notify new location:', err),
      )
    }

    return result
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
}

const deletePlace = async (id: string): Promise<any | null> => {
  const isExist = await Place.findById(id)
  if (!isExist) {
    const isBusiness = await Business.findById(id)
    if (!isBusiness) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
    }
    return await Business.findByIdAndDelete(id)
  }

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const result = await Place.findByIdAndDelete(id).session(session)

    // Remove place from all maps
    await Map.updateMany(
      { places: new mongoose.Types.ObjectId(id) },
      { $pull: { places: new mongoose.Types.ObjectId(id) } },
      { session }
    )

    // Clean up visited references
    await Visited.deleteMany({ $or: [{ place: id }, { business: id }] }).session(session)
    await User.updateMany(
      { visitedPlaces: id },
      { $pull: { visitedPlaces: id }, $inc: { visitedPlacesCount: -1 } },
      { session }
    )

    await session.commitTransaction()
    return result
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
}

const recommendPlace = async (user: any, payload: any): Promise<IPlace> => {
  const privilegedRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MAP_EDITOR]
  const isPrivileged = privilegedRoles.includes(user.role)

  const userId = user.authId || user._id || user.id
  const dbUser = await User.findById(userId)
  if (!dbUser) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not found')
  }

  // Users must reach Level 1 (Aventurero) to recommend spots (unless admin/editor)
  if (!isPrivileged && (dbUser.level || 0) < 1) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'You must reach Level 1 (Aventurero) to recommend new tourist spots. Continue exploring and reviewing places to level up!'
    )
  }

  // Ensure spot is submitted as Pending
  payload.status = 'Pending'
  payload.discoveredBy = dbUser._id
  payload.discoveredByName = dbUser.name || 'Anonymous Explorer'
  payload.pointsAwarded = 0
  payload.adminFeedback = ''

  if (!payload.description) {
    payload.description = payload.name || 'Lugar recomendado'
  }

  await processPlaceTranslations(payload)

  // 1. Resolve map and align country to designated map
  let map: any = null
  if (payload.map) {
    map = await Map.findById(payload.map)
    if (!map) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Map not found')
    }
    const mapCountry =
      map.country ||
      (typeof map.name === 'object' && map.name !== null
        ? (map.name as any).en || (map.name as any).es || Object.values(map.name)[0]
        : map.name)
    if (mapCountry) {
      payload.country = String(mapCountry).trim()
    }
  }

  // 2. Auto-populate country if still missing
  if (!payload.country && payload.location?.coordinates) {
    const [lng, lat] = payload.location.coordinates
    const country = await getCountryFromCoordinates(lat, lng)
    if (country) {
      payload.country = country
    } else {
      payload.country = 'Roadtripeado'
    }
  }

  const createdPlace = await Place.create(payload)
  return createdPlace
}

const reviewRecommendedPlace = async (
  id: string,
  payload: {
    status: 'Published' | 'Rejected'
    adminFeedback?: string
    pointsAwarded?: number
  }
): Promise<any> => {
  const place = await Place.findById(id)
  if (!place) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
  }

  if (place.status === 'Published' && payload.status === 'Published') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Place is already published')
  }

  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const points = payload.pointsAwarded !== undefined ? payload.pointsAwarded : 25

    const updateData: any = {
      status: payload.status,
      adminFeedback: payload.adminFeedback || '',
    }

    if (payload.status === 'Published') {
      updateData.pointsAwarded = points
      updateData.isApproved = true
    }

    const updatedPlace = await Place.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, session }
    )
      .populate('category')
      .populate('map')

    if (!updatedPlace) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Place not found')
    }

    let levelUnlockedData: { newLevel: number; levelName: string; oldLevel: number } | null = null

    // If published, link to map and award points to discoveredBy
    if (payload.status === 'Published') {
      await Map.findByIdAndUpdate(
        place.map,
        {
          $addToSet: { places: updatedPlace._id },
          ...(updatedPlace.country ? { $set: { country: updatedPlace.country } } : {}),
        },
        { session }
      )

      if (place.discoveredBy) {
        const contributor = await User.findById(place.discoveredBy).session(session)
        if (contributor) {
          const oldLevel = contributor.level || 0
          const newPoints = (contributor.points || 0) + points
          const levelInfo = await LevelConfigServices.getDynamicUserLevel(
            newPoints,
            contributor.totalReviewsApproved || 0
          )
          const newLevel = levelInfo.levelNumber

          if (newLevel > oldLevel) {
            levelUnlockedData = {
              newLevel,
              levelName: levelInfo.title || `Nivel ${newLevel}`,
              oldLevel,
            }
          }

          await User.findByIdAndUpdate(
            place.discoveredBy,
            { $set: { points: newPoints, level: newLevel } },
            { session }
          )
        }
      }
    }

    await session.commitTransaction()

    const placeName =
      typeof updatedPlace.name === 'object' && updatedPlace.name !== null
        ? (updatedPlace.name as any).es || (updatedPlace.name as any).en || 'Lugar'
        : updatedPlace.name || 'Lugar'

    if (payload.status === 'Published') {
      if (place.discoveredBy) {
        NotificationServices.createNotification({
          userId: place.discoveredBy,
          title: {
            es: '¡Tu recomendación de lugar ha sido aprobada! 🌟',
            en: 'Your recommended tourist spot has been approved! 🌟',
          },
          content: {
            es: `¡Felicidades! Tu lugar "${placeName}" ha sido aprobado y publicado en el mapa. Has ganado ${points} puntos.`,
            en: `Congratulations! Your spot "${placeName}" has been approved and published to the map. You earned ${points} points.`,
          },
          type: NotificationType.EARNED_REWARD,
          category: NotificationCategory.ROADTRIPEADO,
          priority: NotificationPriority.HIGH,
          actionUrl: `/places/${updatedPlace._id}`,
          actionText: {
            es: 'Ver Lugar',
            en: 'View Spot',
          },
          metadata: {
            placeId: updatedPlace._id,
            pointsAwarded: points,
          },
        }).catch(err => console.error('Error sending spot approval notification:', err))

        if (levelUnlockedData) {
          NotificationIntegration.onLevelUnlocked({
            userId: place.discoveredBy,
            newLevel: levelUnlockedData.newLevel,
            levelName: levelUnlockedData.levelName,
            oldLevel: levelUnlockedData.oldLevel,
          }).catch(err => console.error('Error sending level unlocked notification:', err))
        }
      }

      NotificationIntegration.onNewLocation(updatedPlace).catch(err =>
        console.error('Failed to notify new location:', err),
      )
    } else if (payload.status === 'Rejected' && place.discoveredBy) {
      NotificationServices.createNotification({
        userId: place.discoveredBy,
        title: {
          es: 'Actualización sobre tu sugerencia de lugar',
          en: 'Update on your suggested spot',
        },
        content: {
          es: `Tu sugerencia para "${placeName}" no pudo ser aprobada en este momento.${payload.adminFeedback ? ` Motivo: ${payload.adminFeedback}` : ''}`,
          en: `Your suggestion for "${placeName}" could not be approved at this time.${payload.adminFeedback ? ` Reason: ${payload.adminFeedback}` : ''}`,
        },
        type: NotificationType.SYSTEM_ALERT,
        category: NotificationCategory.ROADTRIPEADO,
        priority: NotificationPriority.MEDIUM,
        metadata: {
          placeId: updatedPlace._id,
          adminFeedback: payload.adminFeedback,
        },
      }).catch(err => console.error('Error sending spot rejection notification:', err))
    }

    return updatedPlace
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
}

const getMyRecommendations = async (
  userId: string,
  paginationOptions: IPaginationOptions,
  statusFilter?: string
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelper.calculatePagination(paginationOptions)

  const filter: any = { discoveredBy: userId }
  if (statusFilter && statusFilter !== 'all') {
    if (statusFilter === 'Published' || statusFilter === 'Approved') {
      filter.$or = [
        { status: 'Published' },
        { isApproved: true },
        { pointsAwarded: { $gt: 0 } },
      ]
    } else if (statusFilter === 'Pending') {
      filter.status = 'Pending'
      filter.isApproved = { $ne: true }
      filter.pointsAwarded = { $lte: 0 }
    } else {
      filter.status = statusFilter
    }
  }

  const [data, total] = await Promise.all([
    Place.find(filter)
      .populate('category')
      .populate('map', 'name country')
      .sort({ [sortBy || 'createdAt']: sortOrder || -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Place.countDocuments(filter),
  ])

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data,
  }
}

export const PlaceService = {
  createPlace,
  getAllPlaces,
  getPlaceById,
  incrementOpenCount,
  updatePlace,
  deletePlace,
  recommendPlace,
  reviewRecommendedPlace,
  getMyRecommendations,
}
