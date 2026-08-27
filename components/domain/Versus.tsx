import type { Match, PublicTeam } from '@/lib/types'
import { isByeMatch } from '@/lib/bracket'
import styles from './Versus.module.css'

export interface VersusProps {
  match: Match
  a: PublicTeam | null
  b: PublicTeam | null
}

export function Versus({ match, a, b }: VersusProps) {
  const decided = match.winnerTeamId !== null
  const aWon = decided && match.winnerTeamId === a?.id
  const bye = isByeMatch(match)
  const emptyTag = bye ? '轮空' : '待定'
  const emptyName = bye ? '自动晋级，无需对手' : '等待上一轮结果'

  return (
    <div className={styles.versus}>
      <div className={styles.side}>
        <div className={`${styles.role} ${styles.roleCt}`}>CT · 蓝方</div>
        <div className={styles.tag}>{a?.tag ?? emptyTag}</div>
        <div className={styles.name}>{a?.name ?? emptyName}</div>
      </div>

      <div className={styles.center}>
        <div className={styles.score}>
          {bye ? (
            <span className={styles.win}>轮空</span>
          ) : (
            <>
              <span className={decided && !aWon ? styles.lose : styles.win}>{match.scoreA ?? 0}</span>
              <span className={styles.colon}>:</span>
              <span className={decided && aWon ? styles.lose : styles.win}>{match.scoreB ?? 0}</span>
            </>
          )}
        </div>
        <div className={styles.meta}>
          {match.roundLabel} · BO{match.bestOf}
        </div>
      </div>

      <div className={`${styles.side} ${styles.right}`}>
        <div className={`${styles.role} ${styles.roleT}`}>T · 金方</div>
        <div className={styles.tag}>{b?.tag ?? emptyTag}</div>
        <div className={styles.name}>{b?.name ?? emptyName}</div>
      </div>
    </div>
  )
}
