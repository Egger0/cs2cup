import type { VetoAction } from '@/lib/types'
import type { ChosenBy, EditableRow, TeamLabel } from './match-report-model'
import styles from './MatchReportRow.module.css'

const ACTIONS: { value: VetoAction; label: string }[] = [
  { value: 'ban', label: 'Ban' },
  { value: 'pick', label: 'Pick' },
  { value: 'decider', label: '决胜图' },
]

interface MatchReportRowProps {
  row: EditableRow
  index: number
  rowCount: number
  pending: boolean
  listId: string
  teamA: TeamLabel
  teamB: TeamLabel
  onPatch: (key: string, patch: Partial<EditableRow>) => void
  onMove: (key: string, offset: -1 | 1) => void
  onRemove: (key: string) => void
}

export function MatchReportRow({
  row,
  index,
  rowCount,
  pending,
  listId,
  teamA,
  teamB,
  onPatch,
  onMove,
  onRemove,
}: MatchReportRowProps) {
  const titleId = `report-row-${row.key}`

  return (
    <li className={styles.row} aria-labelledby={titleId}>
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
            onClick={() => onMove(row.key, -1)}
          >
            ↑ 上移
          </button>
          <button
            type="button"
            className={styles.smallButton}
            disabled={pending || index === rowCount - 1}
            aria-label={`下移第 ${index + 1} 条记录`}
            onClick={() => onMove(row.key, 1)}
          >
            ↓ 下移
          </button>
          <button
            type="button"
            className={`${styles.smallButton} ${styles.remove}`}
            disabled={pending}
            aria-label={`移除第 ${index + 1} 条记录`}
            onClick={() => onRemove(row.key)}
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
            onChange={event => onPatch(row.key, { mapName: event.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span>操作</span>
          <select
            value={row.action}
            disabled={pending}
            onChange={event => {
              const action = event.target.value as VetoAction
              onPatch(
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
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>执行方</span>
          <select
            value={row.chosenBy}
            disabled={pending || row.action === 'decider'}
            onChange={event => onPatch(row.key, { chosenBy: event.target.value as ChosenBy })}
          >
            <option value="">未指定</option>
            <option value="a">
              {teamA.tag} · {teamA.name}
            </option>
            <option value="b">
              {teamB.tag} · {teamB.name}
            </option>
          </select>
        </label>

        <label className={styles.played}>
          <input
            type="checkbox"
            checked={row.played}
            disabled={pending || row.action === 'ban'}
            onChange={event =>
              onPatch(
                row.key,
                event.target.checked ? { played: true } : { played: false, scoreA: '', scoreB: '' },
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
              onChange={event => onPatch(row.key, { scoreA: event.target.value })}
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
              onChange={event => onPatch(row.key, { scoreB: event.target.value })}
            />
          </label>
        </fieldset>
      ) : null}
    </li>
  )
}
