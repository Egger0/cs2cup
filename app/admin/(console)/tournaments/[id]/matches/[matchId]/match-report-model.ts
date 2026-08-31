import type { MatchMap, VetoAction } from '@/lib/types'

export type ChosenBy = 'a' | 'b' | ''

export interface EditableRow {
  key: string
  mapName: string
  action: VetoAction
  chosenBy: ChosenBy
  scoreA: string
  scoreB: string
  played: boolean
}

interface ReportRow {
  mapName: string
  action: VetoAction
  chosenBy: 'a' | 'b' | null
  scoreA: number | null
  scoreB: number | null
  played: boolean
}

type ValidationResult =
  | { ok: false; error: string }
  | { ok: true; rows: ReportRow[]; scoreA: number; scoreB: number }

export interface TeamLabel {
  id: number
  name: string
  tag: string
}

export interface MatchReportEditorProps {
  matchId: number
  tournamentId: number
  bestOf: number
  mapPool: string[]
  initialMaps: MatchMap[]
  teamA: TeamLabel
  teamB: TeamLabel
}

export function initialRows(maps: MatchMap[]): EditableRow[] {
  return maps.map(map => ({
    key: `saved-${map.id}`,
    mapName: map.mapName,
    action: map.action,
    chosenBy: map.chosenBy ?? '',
    scoreA: map.played && map.scoreA !== null ? String(map.scoreA) : '',
    scoreB: map.played && map.scoreB !== null ? String(map.scoreB) : '',
    played: map.action === 'ban' ? false : map.played,
  }))
}

export function createRow(key: string, mapName: string): EditableRow {
  return {
    key,
    mapName,
    action: 'ban',
    chosenBy: '',
    scoreA: '',
    scoreB: '',
    played: false,
  }
}

function numberOrNull(value: string) {
  if (value.trim() === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

export function serialiseRows(rows: EditableRow[]): ReportRow[] {
  return rows.map(row => {
    const played = row.action !== 'ban' && row.played
    return {
      mapName: row.mapName.trim(),
      action: row.action,
      chosenBy: row.chosenBy || null,
      scoreA: played ? numberOrNull(row.scoreA) : null,
      scoreB: played ? numberOrNull(row.scoreB) : null,
      played,
    }
  })
}

export function summariseRows(rows: EditableRow[]) {
  let scoreA = 0
  let scoreB = 0
  let played = 0

  for (const row of rows) {
    if (row.action === 'ban' || !row.played) continue
    const a = numberOrNull(row.scoreA)
    const b = numberOrNull(row.scoreB)
    if (a === null || b === null || a === b) continue
    played += 1
    if (a > b) scoreA += 1
    else scoreB += 1
  }

  return { scoreA, scoreB, played }
}

export function validateRows(
  rows: ReportRow[],
  bestOf: number,
  mapPool: string[],
): ValidationResult {
  const seen = new Set<string>()
  const allowedMaps = new Set(mapPool)
  let played = 0
  let scoreA = 0
  let scoreB = 0
  let deciders = 0
  const target = Math.floor(bestOf / 2) + 1

  for (const [index, row] of rows.entries()) {
    const order = index + 1
    if (!row.mapName) return { ok: false, error: `第 ${order} 条记录还没有填写地图名称` }
    if (!allowedMaps.has(row.mapName)) {
      return { ok: false, error: `地图「${row.mapName}」不在本届赛事地图池中` }
    }

    const normalisedName = row.mapName.toLocaleLowerCase('zh-CN')
    if (seen.has(normalisedName)) {
      return { ok: false, error: `地图「${row.mapName}」重复出现` }
    }
    seen.add(normalisedName)

    if ((row.action === 'ban' || row.action === 'pick') && row.chosenBy === null) {
      return { ok: false, error: `第 ${order} 条 ${row.action.toUpperCase()} 需要指定执行方` }
    }
    if (row.action === 'decider') {
      deciders += 1
      if (row.chosenBy !== null) return { ok: false, error: '决胜图不能指定执行方' }
      if (deciders > 1) return { ok: false, error: '一场比赛最多只能有一张决胜图' }
    }

    if (!row.played) continue
    if (scoreA >= target || scoreB >= target) {
      return { ok: false, error: `系列赛已分出胜负，第 ${order} 张地图不能再标记为已进行` }
    }
    played += 1
    if (row.scoreA === null || row.scoreB === null) {
      return { ok: false, error: `第 ${order} 张已进行地图需要填写双方比分` }
    }
    if (row.scoreA === row.scoreB) {
      return { ok: false, error: `第 ${order} 张地图不能以平局结束` }
    }
    if (row.scoreA > row.scoreB) scoreA += 1
    else scoreB += 1
  }

  if (played > bestOf) {
    return { ok: false, error: `BO${bestOf} 最多记录 ${bestOf} 张已进行地图` }
  }
  if (scoreA > target || scoreB > target) {
    return { ok: false, error: `BO${bestOf} 单方最多赢下 ${target} 张地图` }
  }

  return { ok: true, rows, scoreA, scoreB }
}
