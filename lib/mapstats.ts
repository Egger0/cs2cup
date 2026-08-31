import type { MatchMap } from './types'

export interface MapStat {
  name: string
  picked: number
  banned: number
  decider: number
  played: number
  total: number
  pickRate: number
  banRate: number
}

export function mapStats(maps: MatchMap[], pool: string[]): MapStat[] {
  const byName = new Map<string, MapStat>()
  const ensure = (name: string) => {
    let stat = byName.get(name)
    if (!stat) {
      stat = {
        name,
        picked: 0,
        banned: 0,
        decider: 0,
        played: 0,
        total: 0,
        pickRate: 0,
        banRate: 0,
      }
      byName.set(name, stat)
    }
    return stat
  }

  for (const name of pool) ensure(name)

  for (const entry of maps) {
    const stat = ensure(entry.mapName)
    stat.total += 1
    if (entry.action === 'ban') stat.banned += 1
    if (entry.action === 'pick') stat.picked += 1
    if (entry.action === 'decider') stat.decider += 1
    if (entry.played) stat.played += 1
  }

  const rounds = new Set(maps.map(entry => entry.matchId)).size || 1

  return [...byName.values()]
    .map(stat => ({
      ...stat,
      pickRate: Math.round(((stat.picked + stat.decider) / rounds) * 100),
      banRate: Math.round((stat.banned / rounds) * 100),
    }))
    .sort((a, b) => b.played - a.played || b.picked - a.picked || a.name.localeCompare(b.name))
}
