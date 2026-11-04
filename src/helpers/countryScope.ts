import { Map } from '../modules/map/map.model'

/** Match canonical countries and translated map labels used by older records. */
export const getCountryScope = async (country: string) => {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exact = new RegExp(`^${escape(country.trim())}$`, 'i')
  const maps = await Map.find({ $or: [{ country: exact }, { name: exact }, { 'name.en': exact }, { 'name.es': exact }] })
    .select('_id country name').lean()
  const names = new Set<string>([country.trim()])
  for (const map of maps) {
    for (const name of [map.country, typeof map.name === 'string' ? map.name : '', (map.name as any)?.en, (map.name as any)?.es]) {
      if (typeof name === 'string' && name.trim()) names.add(name.trim())
    }
  }
  return { mapIds: maps.map(map => map._id), countries: [...names].map(name => new RegExp(`^${escape(name)}$`, 'i')) }
}
