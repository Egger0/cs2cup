import type { MatchMap } from '@/lib/types'
import styles from './MapVeto.module.css'

interface MapVetoProps {
  maps: MatchMap[]
  teamAName: string
  teamBName: string
}

const ACTION_LABEL = { ban: 'BAN', pick: 'PICK', decider: 'DECIDER' } as const

export function MapVeto({ maps, teamAName, teamBName }: MapVetoProps) {
  if (maps.length === 0) {
    return (
      <div className={styles.empty}>
        <span className="readout">Ban / Pick</span>
        <p>尚未录入地图选择。对局开始前，Ban/Pick 会显示在这里。</p>
      </div>
    )
  }

  const sideName = (side: 'a' | 'b' | null) => {
    if (side === 'a') return teamAName
    if (side === 'b') return teamBName
    return '剩余'
  }

  return (
    <div className={styles.veto}>
      <div className={styles.head}>
        <span className="readout">Ban / Pick</span>
        <span className="readout">{maps.filter(map => map.played).length} 图打完</span>
      </div>

      <ol className={styles.rows}>
        {maps.map(map => {
          const tone =
            map.action === 'ban'
              ? styles.banned
              : map.action === 'decider'
                ? styles.decider
                : styles.picked

          const aWon = map.scoreA !== null && map.scoreB !== null && map.scoreA > map.scoreB

          return (
            <li key={map.id} className={`${styles.row} ${tone}`}>
              <span className={styles.order}>{String(map.pickOrder).padStart(2, '0')}</span>

              <span className={styles.mapCell}>
                <span className={styles.actor}>
                  {ACTION_LABEL[map.action]}
                  {map.action === 'pick' ? ` · ${sideName(map.chosenBy)}` : ''}
                </span>
                <span className={styles.mapName}>{map.mapName}</span>
              </span>

              {map.played && map.scoreA !== null && map.scoreB !== null ? (
                <span className={styles.score}>
                  <span className={aWon ? styles.scoreWin : styles.scoreLose}>{map.scoreA}</span>
                  <span className={styles.scoreLose}> : </span>
                  <span className={aWon ? styles.scoreLose : styles.scoreWin}>{map.scoreB}</span>
                </span>
              ) : (
                <span className={styles.unplayed}>
                  {map.action === 'ban' ? sideName(map.chosenBy) : '未进行'}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
