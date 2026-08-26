import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Empty } from '@/components/ui'
import { PostList } from '@/components/domain/PostList'
import { SectionHead } from '@/components/domain/Sections'
import { TournamentList } from '@/components/domain/TournamentList'
import { getGame, listGames, listPosts, listTournaments, safely } from '@/lib/queries/public'

export const revalidate = 300

export async function generateStaticParams() {
  const games = await safely(listGames, [])
  return games.map(game => ({ slug: game.slug }))
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const game = await getGame(slug)
  if (!game) notFound()

  const [tournaments, posts] = await Promise.all([
    safely(listTournaments, []),
    safely(() => listPosts(), []),
  ])

  const mine = tournaments.filter(tournament => tournament.gameId === game.id)
  const news = posts.filter(post => post.gameId === game.id)

  return (
    <>
      <section className="section">
        <div className="wrap">
          <div data-rise>
            <SectionHead
              eyebrow={game.nameEn ?? game.slug}
              title={game.name}
              lede={game.tagline ?? undefined}
            />
          </div>
          {mine.length > 0 ? (
            <TournamentList tournaments={mine} />
          ) : (
            <Empty>
              这个项目还没有赛事。想牵头办一场?
              <Link href="/about" style={{ color: 'var(--t)' }}>
                {' '}
                来找我们
              </Link>
            </Empty>
          )}
        </div>
      </section>

      {news.length > 0 ? (
        <>
          <div className="divider" />
          <section className="section">
            <div className="wrap">
              <div data-rise>
                <SectionHead eyebrow="动态" title={`${game.name} 相关`} />
              </div>
              <PostList posts={news} />
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}
