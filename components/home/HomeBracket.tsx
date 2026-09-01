import Image from 'next/image'
import styles from './HomeBracket.module.css'

export function HomeBracket() {
  return (
    <div className={styles.visual} aria-hidden="true">
      <svg className={styles.bracket} viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice">
        <g className={`${styles.routes} ${styles.roundOne}`}>
          <path pathLength="1" d="M36 84H210V148H36" />
          <path pathLength="1" d="M36 244H210V308H36" />
          <path pathLength="1" d="M36 452H210V516H36" />
          <path pathLength="1" d="M36 612H210V676H36" />
          <path pathLength="1" d="M1404 84H1230V148H1404" />
          <path pathLength="1" d="M1404 244H1230V308H1404" />
          <path pathLength="1" d="M1404 452H1230V516H1404" />
          <path pathLength="1" d="M1404 612H1230V676H1404" />
        </g>

        <g className={`${styles.routes} ${styles.roundTwo}`}>
          <path pathLength="1" d="M210 116H370V276H210" />
          <path pathLength="1" d="M210 484H370V644H210" />
          <path pathLength="1" d="M1230 116H1070V276H1230" />
          <path pathLength="1" d="M1230 484H1070V644H1230" />
        </g>

        <g className={`${styles.routes} ${styles.roundThree}`}>
          <path pathLength="1" d="M370 196H540V564H370" />
          <path pathLength="1" d="M1070 196H900V564H1070" />
        </g>

        <g className={`${styles.routes} ${styles.roundFinal}`}>
          <path pathLength="1" d="M540 380H702" />
          <path pathLength="1" d="M900 380H738" />
        </g>

        <path className={styles.finalAxis} pathLength="1" d="M720 30V730" data-home-final-axis />
        <rect
          className={styles.finalNode}
          x="702"
          y="362"
          width="36"
          height="36"
          data-home-final-node
        />
      </svg>

      <div className={styles.clubMark} data-home-club-mark>
        <Image src="/brand/club-mark.svg" alt="" width={600} height={600} priority />
      </div>
    </div>
  )
}
