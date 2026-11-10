'use client'

import { useRef, useState, type CSSProperties } from 'react'
import type { PlayerProfile } from '@/lib/queries/player-profile'
import { hueOf } from './hue'
import { useTilt } from './useTilt'
import styles from './PlayerCard.module.css'
import back from './PlayerCardBack.module.css'

const SPOTS = [
  [50, 52],
  [22, 40],
  [78, 44],
]

function Seal({ title, season, seed }: { title: string; season: string; seed: string }) {
  const id = `seal-${seed.replace(/\W/g, '')}`
  return (
    <svg
      className={back.seal}
      viewBox="-50 -50 100 100"
      style={
        {
          '--ink': `oklch(0.66 0.17 ${hueOf(seed)})`,
          rotate: `${(hueOf(seed) % 40) - 20}deg`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <defs>
        <path id={id} d="M -36 0 A 36 36 0 1 1 36 0 A 36 36 0 1 1 -36 0" />
      </defs>
      <circle r="46" />
      <circle r="28" />
      <text>
        <textPath href={`#${id}`} startOffset="2%">
          {`${title} · ${title} · `.slice(0, 26)}
        </textPath>
      </text>
      <text className={back.sealCenter} y="5">
        {season}
      </text>
    </svg>
  )
}

export function PlayerCard({ profile }: { profile: PlayerProfile }) {
  const card = useRef<HTMLDivElement>(null)
  const [flipped, setFlipped] = useState(false)
  useTilt(card, 'stage')

  const titles = profile.entries.filter(entry => entry.champion).length
  const seasons = profile.entries.map(entry => entry.season).sort()
  const tier = titles > 0 ? 'gold' : profile.entries.length >= 3 ? 'aurora' : undefined
  const word = profile.handle.toUpperCase()
  const stamps = profile.entries.slice(0, SPOTS.length)

  return (
    <div
      ref={card}
      className={styles.card}
      data-tier={tier}
      data-flipped={flipped ? '' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={`${profile.displayName} 的选手卡，点击翻面`}
      style={
        {
          '--hue': hueOf(profile.handle),
          '--fit': `min(46cqi, ${(150 / Math.max(word.length, 3)).toFixed(2)}cqi)`,
        } as CSSProperties
      }
      onClick={() => setFlipped(value => !value)}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        setFlipped(value => !value)
      }}
    >
      <div className={styles.tilt}>
        <div className={styles.flip}>
          <section className={`${styles.face} ${styles.front}`}>
            <div className={`${styles.layer} ${styles.sky}`} />
            <span className={`${styles.layer} ${styles.word}`} aria-hidden="true">
              {word}
            </span>
            <div className={`${styles.layer} ${styles.subject}`}>
              <span className={styles.ring} />
            </div>
            <div className={styles.blurs} aria-hidden="true">
              {[1, 2, 3].map(index => (
                <div key={index} style={{ '--index': index, '--layers': 3 } as CSSProperties} />
              ))}
            </div>
            <header className={styles.topline}>
              <span>NINGLI ESPORTS</span>
              <span>{seasons[0] ? `SINCE ${seasons[0]}` : 'ROOKIE'}</span>
            </header>
            <div className={styles.meta}>
              <p className={styles.name}>{profile.displayName}</p>
              <p className={styles.sub}>
                {profile.entries.length} 届赛事
                {titles ? ` · ${titles} 冠` : ''} · {profile.followers} 关注
              </p>
            </div>
            <div className={styles.sparkle} />
            <div className={styles.frame} aria-hidden="true">
              <i className={styles.band} />
            </div>
            <div className={styles.glare} />
          </section>
          <section className={`${styles.face} ${back.back}`}>
            <div className={back.stamps}>
              {stamps.length ? (
                stamps.map((entry, index) => (
                  <div
                    key={`${entry.tournamentSlug}-${entry.teamTag}`}
                    style={
                      {
                        '--x0': `${SPOTS[stamps.length - 1 - index]![0]}%`,
                        '--y0': `${SPOTS[stamps.length - 1 - index]![1]}%`,
                      } as CSSProperties
                    }
                  >
                    <Seal
                      title={entry.tournamentTitle}
                      season={entry.season}
                      seed={`${entry.tournamentSlug}${profile.handle}`}
                    />
                  </div>
                ))
              ) : (
                <span className={styles.ring} />
              )}
            </div>
            <dl>
              <div>
                <dt>代号</dt>
                <dd>@{profile.handle}</dd>
              </div>
              <div>
                <dt>参赛</dt>
                <dd>{profile.entries.length} 届</dd>
              </div>
              <div>
                <dt>冠军</dt>
                <dd>{titles} 次</dd>
              </div>
              <div>
                <dt>战队</dt>
                <dd>{profile.entries[0]?.teamName ?? '—'}</dd>
              </div>
            </dl>
            <p className={back.motto}>{profile.bio ?? '在宁理，为热爱上场。'}</p>
            <p className={back.org}>浙大宁波理工学院电竞社</p>
            <div className={styles.frame} aria-hidden="true">
              <i className={styles.band} />
            </div>
            <div className={styles.glare} />
          </section>
        </div>
      </div>
    </div>
  )
}
