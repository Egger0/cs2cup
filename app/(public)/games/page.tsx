import Link from 'next/link'
import { SectionHead } from '@/components/domain/Sections'
import { listGames, listTournaments, safely } from '@/lib/queries/public'
import styles from '../home.module.css'

export const revalidate = 300

export const metadata = { title: '项目 · 宁波理工电竞社' }

export default async function GamesPage() {
  const [games, tournaments] = await Promise.all([
    safely(listGames, []),
    safely(listTournaments, []),
  ])

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow="项目"
            title="我们在玩什么"
            lede="社团不只打一款游戏。每个项目都有自己的赛事、队伍和活动。"
          />
        </div>
        <div className={styles.games}>
          {games.map(game => {
            const count = tournaments.filter(t => t.gameId === game.id).length
            return (
              <Link
                key={game.id}
                href={`/games/${game.slug}`}
                className={styles.game}
                data-game={game.slug}
              >
                <div className={styles.gameName}>{game.name}</div>
                <div className={styles.gameEn}>{game.nameEn ?? game.slug}</div>
                {game.tagline ? <p className={styles.gameTagline}>{game.tagline}</p> : null}
                <div className={styles.gameMeta}>
                  <span className={styles.gameStatusDot} aria-hidden="true" />
                  <span className={styles.gameMetaText}>
                    {count > 0 ? (
                      <>
                        已举办 <strong>{String(count).padStart(2, '0')}</strong> 届赛事
                      </>
                    ) : (
                      '赛季筹备中'
                    )}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
