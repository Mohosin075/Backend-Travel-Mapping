import { IPlace } from './place.interface'

export const inactivePlaceFields = (type: IPlace['type']): string[] =>
  type === 'Business'
    ? ['schedules', 'entryCost', 'difficulty', 'hikeTime']
    : ['operatingHours', 'phone', 'website', 'instagram', 'menuImages']

export function scopePlaceFields(payload: Partial<IPlace>, type: IPlace['type']) {
  const scoped = { ...payload }
  for (const key of inactivePlaceFields(type)) delete (scoped as any)[key]
  return scoped
}
