import type { Match, PublicTeam } from '@/lib/types'
import { isByeMatch, isCompletedMatch } from '@/lib/bracket'
import type { ScheduleStatus } from '@/lib/schedule'
import styles from './Versus.module.css'

interface VersusProps {
  match: Match
  a: PublicTeam | null
  b: PublicTeam | null
  status?: ScheduleStatus
}

const STATE_LABEL: Record<ScheduleStatus, string> = {
  completed: '已结束',
  upcoming: '未开始',
  overdue: '待更新',
  waiting: '等待对阵',
  unscheduled: '时间待定',
}

export function Versus({ match, a, b, status }: VersusProps) {
  const decided = isCompletedMatch(match)
  const aWon = decided && match.winnerTeamId === a?.id
  const bye = isByeMatch(match)
  const emptyTag = bye ? '轮空' : '待定'
  const emptyName = bye ? '自动晋级，无需对手' : '等待上一轮结果'
  const state = decided ? '已结束' : status ? STATE_LABEL[status] : !a || !b ? '等待对阵' : '未开始'

  return (
    <div className={styles.versus}>
      <div className={styles.side}>
        <div className={`${styles.role} ${styles.roleA}`}>A 方</div>
        <div className={styles.tag}>{a?.tag ?? emptyTag}</div>
        <div className={styles.name}>{a?.name ?? emptyName}</div>
      </div>

      <div className={styles.center}>
        <div className={styles.score}>
          {bye ? (
            <span className={styles.win}>轮空</span>
          ) : decided ? (
            <>
              <span className={decided && !aWon ? styles.lose : styles.win}>
                {match.scoreA ?? 0}
              </span>
              <span className={styles.colon}>:</span>
              <span className={decided && aWon ? styles.lose : styles.win}>
                {match.scoreB ?? 0}
              </span>
            </>
          ) : (
            <span className={styles.pendingScore}>— : —</span>
          )}
        </div>
        <div className={styles.meta}>
          {state} · {match.roundLabel} · BO{match.bestOf}
        </div>
      </div>

      <div className={`${styles.side} ${styles.right}`}>
        <div className={`${styles.role} ${styles.roleB}`}>B 方</div>
        <div className={styles.tag}>{b?.tag ?? emptyTag}</div>
        <div className={styles.name}>{b?.name ?? emptyName}</div>
      </div>
    </div>
  )
}
