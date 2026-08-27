'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import type { MatchMap, VetoAction } from '@/lib/types'
import { saveMatchReport } from '../../../../_actions'
import styles from './MatchReportEditor.module.css'

type ChosenBy = 'a' | 'b' | ''

interface EditableRow {
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

interface TeamLabel {
  id: number
  name: string
  tag: string
}

interface MatchReportEditorProps {
  matchId: number
  tournamentId: number
  bestOf: number
  mapPool: string[]
  initialMaps: MatchMap[]
  teamA: TeamLabel
  teamB: TeamLabel
}

const ACTIONS: { value: VetoAction; label: string }[] = [
  { value: 'ban', label: 'Ban' },
  { value: 'pick', label: 'Pick' },
  { value: 'decider', label: '决胜图' },
]

function initialRows(maps: MatchMap[]): EditableRow[] {
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

function numberOrNull(value: string) {
  if (value.trim() === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

function serialise(rows: EditableRow[]): ReportRow[] {
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

function validate(rows: ReportRow[], bestOf: number, mapPool: string[]): ValidationResult {
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
    if (seen.has(normalisedName)) return { ok: false, error: `地图「${row.mapName}」重复出现` }
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
    if (row.scoreA === row.scoreB) return { ok: false, error: `第 ${order} 张地图不能以平局结束` }
    if (row.scoreA > row.scoreB) scoreA += 1
    else scoreB += 1
  }

  if (played > bestOf) return { ok: false, error: `BO${bestOf} 最多记录 ${bestOf} 张已进行地图` }

  if (scoreA > target || scoreB > target) {
    return { ok: false, error: `BO${bestOf} 单方最多赢下 ${target} 张地图` }
  }

  return { ok: true, rows, scoreA, scoreB }
}

export function MatchReportEditor({
  matchId,
  tournamentId,
  bestOf,
  mapPool,
  initialMaps,
  teamA,
  teamB,
}: MatchReportEditorProps) {
  const router = useRouter()
  const nextKey = useRef(0)
  const [rows, setRows] = useState<EditableRow[]>(() => initialRows(initialMaps))
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)
  const listId = `match-${matchId}-maps`
  const target = Math.floor(bestOf / 2) + 1

  const derived = useMemo(() => {
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
  }, [rows])

  function patchRow(key: string, patch: Partial<EditableRow>) {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
    setFeedback(null)
  }

  function addRow() {
    setRows(current => {
      if (current.length >= mapPool.length) return current
      const used = new Set(current.map(row => row.mapName))
      const nextMap = mapPool.find(map => !used.has(map)) ?? ''
      return [
        ...current,
        {
          key: `new-${Date.now()}-${nextKey.current++}`,
          mapName: nextMap,
          action: 'ban',
          chosenBy: '',
          scoreA: '',
          scoreB: '',
          played: false,
        },
      ]
    })
    setFeedback(null)
  }

  function moveRow(key: string, offset: -1 | 1) {
    setRows(current => {
      const index = current.findIndex(row => row.key === key)
      const destination = index + offset
      if (index < 0 || destination < 0 || destination >= current.length) return current
      const next = [...current]
      const source = next[index]
      const target = next[destination]
      if (!source || !target) return current
      next[index] = target
      next[destination] = source
      return next
    })
    setFeedback(null)
  }

  function removeRow(key: string) {
    setRows(current => current.filter(row => row.key !== key))
    setFeedback(null)
  }

  function submit() {
    const checked = validate(serialise(rows), bestOf, mapPool)
    if (!checked.ok) {
      setFeedback({ tone: 'error', message: checked.error })
      return
    }

    setFeedback(null)
    startTransition(async () => {
      try {
        const result = await saveMatchReport(
          matchId,
          tournamentId,
          teamA.id,
          teamB.id,
          JSON.stringify(checked.rows),
        )
        if (!result.ok) {
          setFeedback({ tone: 'error', message: result.error ?? '战报保存失败' })
          return
        }

        const scoreA = result.scoreA ?? checked.scoreA
        const scoreB = result.scoreB ?? checked.scoreB
        const cleared = result.cleared ? `，并清理 ${result.cleared} 场下游赛果` : ''
        setFeedback({
          tone: 'ok',
          message: `已保存，系列赛比分 ${scoreA}:${scoreB}${cleared}`,
        })
        router.refresh()
      } catch {
        setFeedback({ tone: 'error', message: '网络异常，战报未保存' })
      }
    })
  }

  return (
    <section className={styles.editor} aria-labelledby="report-editor-title">
      <div className={styles.summary}>
        <div>
          <p className={styles.kicker} id="report-editor-title">
            系列赛比分 · BO{bestOf}
          </p>
          <p className={styles.hint}>逐图结果会自动汇总；任一方先赢 {target} 图即获胜。</p>
        </div>
        <div className={styles.series} aria-live="polite" aria-label="根据逐图结果计算的系列赛比分">
          <span className={styles.team}>
            <b>{teamA.tag}</b>
            <small>{teamA.name}</small>
          </span>
          <strong className={styles.seriesScore}>
            {derived.scoreA}<i>:</i>{derived.scoreB}
          </strong>
          <span className={`${styles.team} ${styles.teamRight}`}>
            <b>{teamB.tag}</b>
            <small>{teamB.name}</small>
          </span>
        </div>
        <p className={styles.playedCount}>{derived.played} 张有效赛图</p>
      </div>

      <form
        className={styles.form}
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
      >
        <datalist id={listId}>
          {mapPool.map(map => <option key={map} value={map} />)}
        </datalist>

        {rows.length === 0 ? (
          <div className={styles.empty} role="status">
            {mapPool.length === 0
              ? '本届赛事尚未配置地图池，请先到赛事设置中添加地图。'
              : '还没有 Ban/Pick 记录。添加一行开始录入，或直接保存以清空已有战报。'}
          </div>
        ) : (
          <ol className={styles.rows}>
            {rows.map((row, index) => {
              const titleId = `report-row-${row.key}`
              return (
                <li key={row.key} className={styles.row} aria-labelledby={titleId}>
                  <div className={styles.rowHead}>
                    <div>
                      <span className={styles.order}>{String(index + 1).padStart(2, '0')}</span>
                      <h3 id={titleId}>{row.mapName || '未命名地图'}</h3>
                    </div>
                    <div className={styles.orderActions}>
                      <button
                        type="button"
                        className={styles.smallButton}
                        disabled={pending || index === 0}
                        aria-label={`上移第 ${index + 1} 条记录`}
                        onClick={() => moveRow(row.key, -1)}
                      >
                        ↑ 上移
                      </button>
                      <button
                        type="button"
                        className={styles.smallButton}
                        disabled={pending || index === rows.length - 1}
                        aria-label={`下移第 ${index + 1} 条记录`}
                        onClick={() => moveRow(row.key, 1)}
                      >
                        ↓ 下移
                      </button>
                      <button
                        type="button"
                        className={`${styles.smallButton} ${styles.remove}`}
                        disabled={pending}
                        aria-label={`移除第 ${index + 1} 条记录`}
                        onClick={() => removeRow(row.key)}
                      >
                        移除
                      </button>
                    </div>
                  </div>

                  <div className={styles.fields}>
                    <label className={styles.field}>
                      <span>地图</span>
                      <input
                        value={row.mapName}
                        list={listId}
                        required
                        disabled={pending}
                        placeholder="选择或输入地图"
                        onChange={event => patchRow(row.key, { mapName: event.target.value })}
                      />
                    </label>

                    <label className={styles.field}>
                      <span>操作</span>
                      <select
                        value={row.action}
                        disabled={pending}
                        onChange={event => {
                          const action = event.target.value as VetoAction
                          patchRow(
                            row.key,
                            action === 'ban'
                              ? { action, played: false, scoreA: '', scoreB: '' }
                              : action === 'decider'
                                ? { action, chosenBy: '' }
                                : { action },
                          )
                        }}
                      >
                        {ACTIONS.map(action => (
                          <option key={action.value} value={action.value}>{action.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>执行方</span>
                      <select
                        value={row.chosenBy}
                        disabled={pending || row.action === 'decider'}
                        onChange={event => patchRow(row.key, { chosenBy: event.target.value as ChosenBy })}
                      >
                        <option value="">未指定</option>
                        <option value="a">{teamA.tag} · {teamA.name}</option>
                        <option value="b">{teamB.tag} · {teamB.name}</option>
                      </select>
                    </label>

                    <label className={styles.played}>
                      <input
                        type="checkbox"
                        checked={row.played}
                        disabled={pending || row.action === 'ban'}
                        onChange={event =>
                          patchRow(
                            row.key,
                            event.target.checked
                              ? { played: true }
                              : { played: false, scoreA: '', scoreB: '' },
                          )
                        }
                      />
                      <span>{row.action === 'ban' ? 'Ban 不进行' : '已进行'}</span>
                    </label>
                  </div>

                  {row.played && row.action !== 'ban' ? (
                    <fieldset className={styles.mapScore} disabled={pending}>
                      <legend>逐图比分</legend>
                      <label>
                        <span>{teamA.tag}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          required
                          aria-label={`${row.mapName || `第 ${index + 1} 张地图`} ${teamA.name} 比分`}
                          value={row.scoreA}
                          onChange={event => patchRow(row.key, { scoreA: event.target.value })}
                        />
                      </label>
                      <span aria-hidden>:</span>
                      <label>
                        <span>{teamB.tag}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          required
                          aria-label={`${row.mapName || `第 ${index + 1} 张地图`} ${teamB.name} 比分`}
                          value={row.scoreB}
                          onChange={event => patchRow(row.key, { scoreB: event.target.value })}
                        />
                      </label>
                    </fieldset>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}

        <div className={styles.footer}>
          <Button
            type="button"
            disabled={pending || rows.length >= mapPool.length}
            onClick={addRow}
          >
            {mapPool.length > 0 && rows.length >= mapPool.length ? '地图已全部录入' : '添加记录'}
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? '保存中…' : '保存战报'}
          </Button>
          {feedback ? (
            <p
              className={feedback.tone === 'ok' ? styles.success : styles.failure}
              role={feedback.tone === 'error' ? 'alert' : 'status'}
            >
              {feedback.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  )
}
