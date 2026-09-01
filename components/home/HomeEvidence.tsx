import Link from 'next/link'
import motionStyles from './HomeMotion.module.css'
import styles from './HomeEvidence.module.css'

const STAGES = [
  { number: '08', label: '八强', round: 'ROUND 01' },
  { number: '04', label: '四强', round: 'ROUND 02' },
  { number: '02', label: '决赛', round: 'ROUND 03' },
  { number: '01', label: '冠军', round: 'FINAL' },
]

export function HomeEvidence() {
  return (
    <section
      id="route"
      className={`${styles.routeStage} ${motionStyles.routeMotion}`}
      aria-labelledby="route-title"
      data-header-tone="light"
    >
      <div className={styles.routeCanvas}>
        <div className={styles.gridLines} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>

        <header className={styles.routeHeader} data-home-reveal="item">
          <p>NINGLI CUP / 08—01</p>
          <h2 id="route-title">
            <span>从</span>
            <strong>08</strong>
            <span>，到</span>
            <strong>01</strong>
            <span>。</span>
          </h2>
        </header>

        <ol className={styles.stages} data-home-reveal="group" data-home-path>
          {STAGES.map((stage, index) => (
            <li key={stage.number}>
              <span className={styles.round}>{stage.round}</span>
              <strong>{stage.number}</strong>
              <span className={styles.label}>{stage.label}</span>
              {index < STAGES.length - 1 ? (
                <span className={styles.connector} aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>

        <div className={styles.routeFooter} data-home-reveal="item">
          <p>每一条线，都要有人把它组织好。</p>
          <Link href="/tournaments">
            <span>查看完整对阵</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
