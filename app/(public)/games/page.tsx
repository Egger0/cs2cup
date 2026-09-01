import Link from 'next/link'
import { PageMasthead } from '@/components/domain/Sections'
import { Empty } from '@/components/ui'
import { listGames, listTournaments, safely } from '@/lib/queries/public'
import styles from './games.module.css'

export const revalidate = 300

export const metadata = { title: '项目' }

export default async function GamesPage() {
  const [games, tournaments] = await Promise.all([
    safely(listGames, []),
    safely(listTournaments, []),
  ])

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <PageMasthead
            eyebrow="项目"
            title="我们在玩什么"
            lede="社团不只打一款游戏。每个项目都有自己的赛事、队伍和活动。"
          />
        </div>
        {games.length > 0 ? (
          <div className={styles.ledger}>
            {games.map((game, index) => {
              const count = tournaments.filter(t => t.gameId === game.id).length
              return (
                <Link key={game.id} href={`/games/${game.slug}`} className={styles.row}>
                  <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.identity}>
                    <strong className={styles.gameName}>{game.name}</strong>
                    <span className={styles.gameEn}>{game.nameEn ?? game.slug}</span>
                    {game.tagline ? (
                      <span className={styles.gameTagline}>{game.tagline}</span>
                    ) : null}
                  </span>
                  <span className={styles.gameMeta}>
                    <span>
                      {count > 0 ? (
                        <>
                          <b>{String(count).padStart(2, '0')}</b> 届赛事
                        </>
                      ) : (
                        '赛季筹备中'
                      )}
                    </span>
                    <span className={styles.arrow} aria-hidden="true">
                      →
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <Empty>项目目录正在整理</Empty>
        )}
      </div>
    </section>
  )
}
