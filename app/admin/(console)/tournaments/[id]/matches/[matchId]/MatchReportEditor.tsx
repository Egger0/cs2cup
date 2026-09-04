'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { useUnsavedChangesWarning } from '@/components/admin/useUnsavedChangesWarning'
import { confirmScoreWrite } from '@/lib/score-confirmation'
import { saveMatchReport } from '../../../../actions/matches'
import { MatchReportRow } from './MatchReportRow'
import {
  createRow,
  initialRows,
  serialiseRows,
  summariseRows,
  validateRows,
  type EditableRow,
  type MatchReportEditorProps,
} from './match-report-model'
import styles from './MatchReportEditor.module.css'

const UNSAVED_MESSAGE = '战报还有未保存的更改，离开将丢失这些内容。'

function copyRows(rows: EditableRow[]) {
  return rows.map(row => ({ ...row }))
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
  const [savedRows, setSavedRows] = useState<EditableRow[]>(() => initialRows(initialMaps))
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)
  const listId = `match-${matchId}-maps`
  const target = Math.floor(bestOf / 2) + 1
  const derived = useMemo(() => summariseRows(rows), [rows])
  const dirty = useMemo(
    () => JSON.stringify(serialiseRows(rows)) !== JSON.stringify(serialiseRows(savedRows)),
    [rows, savedRows],
  )

  useUnsavedChangesWarning(dirty, UNSAVED_MESSAGE)

  function patchRow(key: string, patch: Partial<EditableRow>) {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
    setFeedback(null)
  }

  function addRow() {
    setRows(current => {
      if (current.length >= mapPool.length) return current
      const used = new Set(current.map(row => row.mapName))
      const nextMap = mapPool.find(map => !used.has(map)) ?? ''
      return [...current, createRow(`new-${Date.now()}-${nextKey.current++}`, nextMap)]
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
    const checked = validateRows(serialiseRows(rows), bestOf, mapPool)
    if (!checked.ok) {
      setFeedback({ tone: 'error', message: checked.error })
      return
    }

    setFeedback(null)
    startTransition(async () => {
      try {
        const result = await confirmScoreWrite(
          confirmationToken =>
            saveMatchReport(
              matchId,
              tournamentId,
              teamA.id,
              teamB.id,
              JSON.stringify(checked.rows),
              confirmationToken,
            ),
          message => window.confirm(message),
        )
        if (!result) return
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
        setSavedRows(copyRows(rows))
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
            {derived.scoreA}
            <i>:</i>
            {derived.scoreB}
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
          {mapPool.map(map => (
            <option key={map} value={map} />
          ))}
        </datalist>

        {rows.length === 0 ? (
          <div className={styles.empty} role="status">
            {mapPool.length === 0
              ? '本届赛事尚未配置地图池，请先到赛事设置中添加地图。'
              : '还没有 Ban/Pick 记录。添加一行开始录入，或直接保存以清空已有战报。'}
          </div>
        ) : (
          <ol className={styles.rows}>
            {rows.map((row, index) => (
              <MatchReportRow
                key={row.key}
                row={row}
                index={index}
                rowCount={rows.length}
                pending={pending}
                listId={listId}
                teamA={teamA}
                teamB={teamB}
                onPatch={patchRow}
                onMove={moveRow}
                onRemove={removeRow}
              />
            ))}
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
          <Button
            type="button"
            disabled={pending || !dirty}
            onClick={() => {
              setRows(copyRows(savedRows))
              setFeedback(null)
            }}
          >
            撤销更改
          </Button>
          <Button type="submit" variant="primary" disabled={pending || !dirty}>
            {pending ? '保存中…' : dirty ? '保存战报' : '已同步'}
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
