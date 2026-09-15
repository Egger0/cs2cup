import Image from 'next/image'
import type { CSSProperties } from 'react'
import type { PlayerBadge, PlayerBadgeKey, PlayerGameCard } from '@/lib/queries/player-profile'
import { PLANET_COLORS } from '@/lib/planets'
import styles from './PlayerGameCards.module.css'

const BADGE_GLYPH: Record<PlayerBadgeKey, string> = {
  debut: 'M8 21V4m0 1h9l-2 4 2 4H8',
  veteran: 'm6 10 6-4 6 4M6 15l6-4 6 4M6 20l6-4 6 4',
  champion: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5v1a3 3 0 0 0 3 3m8-4h3v1a3 3 0 0 1-3 3m-4 3v4m-3 3h6',
  oracle: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  regular: 'M4 6h16v14H4ZM4 10h16M8 3v4m8-4v4m-7 8 2 2 4-4',
}

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

export function PlayerBadges({ badges }: { badges: readonly PlayerBadge[] }) {
  if (!badges.length) return null
  return (
    <ul className={styles.badges} aria-label="勋章">
      {badges.map(badge => (
        <li key={badge.key} className={styles.badge} data-badge={badge.key}>
          <span className={styles.medal}>
            <Glyph path={BADGE_GLYPH[badge.key]} />
          </span>
          <span className={styles.badgeCopy}>
            <strong>{badge.label}</strong>
            <small>{badge.detail}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PlayerGameCards({ cards }: { cards: readonly PlayerGameCard[] }) {
  return (
    <ul className={styles.cards}>
      {cards.map(card => {
        const tone = card.accentColor ?? PLANET_COLORS.get(card.slug) ?? '#8fc8ef'
        const level = Math.min(5, card.entries)
        return (
          <li
            key={card.slug}
            className={styles.card}
            data-level={level}
            style={{ '--tone': tone, '--level': level } as CSSProperties}
          >
            {PLANET_COLORS.has(card.slug) ? (
              <Image
                className={styles.art}
                src={`/models/planet-${card.slug}.webp`}
                alt=""
                width={1600}
                height={924}
                unoptimized
              />
            ) : null}
            <header className={styles.cardHead}>
              <span className={styles.code}>{card.nameEn ?? card.slug}</span>
              <h3>{card.name}</h3>
            </header>
            <p className={styles.count}>
              <strong>{String(card.entries).padStart(2, '0')}</strong>
              <span>届校内赛</span>
            </p>
            <div className={styles.emblems} aria-label={`${card.name}勋章`}>
              <span className={styles.emblem} title="首次出征">
                <Glyph path={BADGE_GLYPH.debut} />
              </span>
              {card.entries >= 3 ? (
                <span className={styles.emblem} title="三届老兵">
                  <Glyph path={BADGE_GLYPH.veteran} />
                </span>
              ) : null}
              {card.titles ? (
                <span className={styles.emblem} title={`冠军 ×${card.titles}`}>
                  <Glyph path={BADGE_GLYPH.champion} />
                  <b>×{card.titles}</b>
                </span>
              ) : null}
            </div>
            <footer className={styles.plate}>
              <strong>{card.latestTeam}</strong>
              <span>{card.latestSeason} · 最近代表</span>
            </footer>
          </li>
        )
      })}
    </ul>
  )
}
