import Link from 'next/link'
import type { CSSProperties } from 'react'
import styles from './HomeEvidence.module.css'

const STAGES = [
  { number: '08', label: '八强', round: 'ROUND 01' },
  { number: '04', label: '四强', round: 'ROUND 02' },
  { number: '02', label: '决赛', round: 'ROUND 03' },
  { number: '01', label: '冠军', round: 'FINAL' },
]
const TICKS = Array.from({ length: 96 }, (_, index) => index)

export function HomeEvidence({ slug }: { slug?: string }) {
  return (
    <section
      id="route"
      className={styles.route}
      data-scene
      data-zone="route"
      aria-labelledby="route-title"
    >
      <div className={styles.stage}>
        <header className={styles.head}>
          <p>NINGLI CUP / 08—01</p>
          <h2 id="route-title">
            从 <strong>08</strong>，到 <strong>01</strong>。
          </h2>
        </header>
        <div className={styles.dial} aria-hidden="true">
          <svg viewBox="-100 -100 200 200">
            <circle className={styles.track} r="92" />
            <circle className={styles.sweep} r="92" pathLength="1" />
            {TICKS.map(index => (
              <line
                key={index}
                className={index % 8 === 0 ? styles.major : undefined}
                x1="0"
                y1="-97"
                x2="0"
                y2={index % 8 === 0 ? -86 : -91}
                transform={`rotate(${index * 3.75})`}
              />
            ))}
          </svg>
          <span className={styles.hand}>
            <i />
          </span>
          <span className={styles.window}>
            <span className={styles.reel}>
              {STAGES.map(stage => (
                <span key={stage.number}>{stage.number}</span>
              ))}
            </span>
          </span>
        </div>
        <ol className={styles.stages}>
          {STAGES.map((stage, index) => (
            <li key={stage.number} style={{ '--i': index } as CSSProperties}>
              <span>{stage.round}</span>
              <strong>{stage.number}</strong>
              <em>{stage.label}</em>
            </li>
          ))}
        </ol>
        <div className={styles.foot}>
          <p>每一条线，都要有人把它组织好。</p>
          <Link href={slug ? `/tournaments/${slug}/bracket` : '/tournaments'}>
            <span>{slug ? '查看完整对阵' : '浏览赛事大厅'}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
