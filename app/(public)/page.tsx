import type { Viewport } from 'next'
import { HomeBackdrop } from '@/components/home/HomeBackdrop'
import { HomeEvidence } from '@/components/home/HomeEvidence'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeHub } from '@/components/home/HomeHub'
import { HomeReveal } from '@/components/home/HomeReveal'
import { HomeScenes } from '@/components/home/HomeScenes'
import { HomeStatement } from '@/components/home/HomeStatement'
import { HomeWall } from '@/components/home/HomeWall'
import { SolarSystem } from '@/components/home/solar/SolarSystem'
import { homeTournamentSignal } from '@/lib/home-tournament-signal'
import {
  getCurrentTournament,
  getPhotos,
  listGames,
  listTournaments,
  listPosts,
  safely,
} from '@/lib/queries/public'

export const metadata = { alternates: { canonical: '/' } }
export const viewport: Viewport = { themeColor: '#06070a' }

export default async function HomePage() {
  const [tournament, posts, games, tournaments, photos] = await Promise.all([
    safely(getCurrentTournament, null),
    safely(() => listPosts(2, 'latest'), []),
    safely(listGames, []),
    safely(listTournaments, []),
    safely(() => getPhotos(), []),
  ])

  return (
    <>
      <HomeBackdrop />
      <SolarSystem
        data={{ games, tournaments, posts: posts.slice(0, 2), currentId: tournament?.id ?? null }}
      />
      <HomeHero
        signal={homeTournamentSignal(tournament)}
        stops={['club', ...games.map(game => game.slug)]}
        current={tournament ? `event-${tournament.slug}` : null}
      />
      <HomeScenes />
      <HomeReveal />
      <HomeStatement
        games={games}
        photo={photos.find(photo => photo.width > photo.height) ?? photos[0] ?? null}
      />
      <HomeWall photos={photos} tournaments={tournaments} />
      <HomeHub tournament={tournament} posts={posts} />
      <HomeEvidence slug={tournament?.slug} />
    </>
  )
}
