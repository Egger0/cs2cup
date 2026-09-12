import type { CSSProperties } from 'react'
import { photoUrl } from '@/lib/media'
import { variantStorageKey } from '@/lib/photo-variants'
import { PLANET_COLORS } from '@/lib/planets'
import type { Game, Photo } from '@/lib/types'
import styles from './HomeStatement.module.css'

export function HomeStatement({ games, photo }: { games: Game[]; photo: Photo | null }) {
  const width = photo?.variantWidths.find(value => value >= 960) ?? photo?.variantWidths.at(-1)
  return (
    <section
      className={styles.statement}
      data-scene
      data-zone="statement"
      aria-labelledby="statement-title"
      style={{ '--count': Math.max(1, games.length) } as CSSProperties}
    >
      <div className={styles.stage}>
        <p className={styles.kicker}>NINGLI ESPORTS CLUB / EST. 2022</p>
        <h2 id="statement-title" className={styles.title}>
          <span className={styles.line}>
            为
            {photo ? (
              <span className={styles.capsule} aria-hidden="true">
                <img
                  data-src={photoUrl(
                    width ? variantStorageKey(photo.storageKey, width) : photo.storageKey,
                  )}
                  alt=""
                  decoding="async"
                />
              </span>
            ) : null}
            热爱
          </span>
          <span className={`${styles.line} ${styles.second}`}>上场</span>
        </h2>
        {games.length ? (
          <div className={styles.games}>
            <p className={styles.hidden}>{games.map(game => game.name).join('、')}</p>
            <span className={styles.window} aria-hidden="true">
              <span className={styles.reel}>
                {games.map(game => (
                  <span
                    key={game.id}
                    style={{
                      color: game.accentColor || PLANET_COLORS.get(game.slug) || '#9bcaeb',
                    }}
                  >
                    {(game.nameEn ?? game.slug).toUpperCase()}
                  </span>
                ))}
              </span>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
