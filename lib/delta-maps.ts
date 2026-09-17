import { DELTA_MAP_SUMMARIES } from './delta-map-summaries'

export const DELTA_MAPS = DELTA_MAP_SUMMARIES

export const deltaMap = (id: string | undefined) =>
  DELTA_MAPS.find(map => map.id === id) ?? DELTA_MAPS[0]!
