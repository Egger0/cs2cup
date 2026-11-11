import type { Viewport } from 'next'
import { preload } from 'react-dom'
import { HomeBackdrop } from '@/components/home/HomeBackdrop'
import { HomeEvidence } from '@/components/home/HomeEvidence'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeHub } from '@/components/home/HomeHub'
import { HomeReveal } from '@/components/home/HomeReveal'
import { HomeScenes } from '@/components/home/HomeScenes'
import { HomeStatement } from '@/components/home/HomeStatement'
import { HomeWall } from '@/components/home/HomeWall'
import { SolarSystem } from '@/components/home/solar/SolarSystem'
import type { UpcomingMatch } from '@/components/home/HomePulse'
import { isCompletedMatch } from '@/lib/bracket'
import { currentTimeMillis } from '@/lib/current-time'
import { homeTournamentSignal } from '@/lib/home-tournament-signal'
import {
  getCurrentTournament,
  getMatches,
  getPhotos,
  getPublicTeams,
  listGames,
  listTournaments,
  listPosts,
  safely,
} from '@/lib/queries/public'
import type { Tournament } from '@/lib/types'

export const metadata = { alternates: { canonical: '/' } }
export const viewport: Viewport = { themeColor: '#06070a' }

async function upcomingMatches(tournament: Tournament | null): Promise<UpcomingMatch[]> {
  if (!tournament) return []
  const [matches, teams] = await Promise.all([
    getMatches(tournament.id),
    getPublicTeams(tournament.id),
  ])
  const names = new Map(teams.map(team => [team.id, team.name]))
  const now = currentTimeMillis()
  return matches
    .filter(match => match.scheduledAt && Date.parse(match.scheduledAt) > now)
    .filter(match => !isCompletedMatch(match) && match.teamAId && match.teamBId)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))
    .slice(0, 3)
    .map(match => ({
      id: match.id,
      href: `/tournaments/${tournament.slug}/matches/${match.id}`,
      round: match.roundLabel,
      teamA: names.get(match.teamAId!) ?? '待定',
      teamB: names.get(match.teamBId!) ?? '待定',
      at: match.scheduledAt!,
    }))
}

export default async function HomePage() {
  preload('/fonts/noto-serif-sc-display.woff2', {
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  })
  const [tournament, posts, games, tournaments, photos] = await Promise.all([
    safely(getCurrentTournament, null),
    safely(() => listPosts(3, 'latest'), []),
    safely(listGames, []),
    safely(listTournaments, []),
    safely(() => getPhotos(), []),
  ])
  const upcoming = await safely(() => upcomingMatches(tournament), [])

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
        latest={posts[0] ? { slug: posts[0].slug, title: posts[0].title } : null}
      />
      <HomeScenes />
      <HomeReveal />
      <HomeStatement
        games={games}
        photo={photos.find(photo => photo.width > photo.height) ?? photos[0] ?? null}
      />
      <HomeWall photos={photos} tournaments={tournaments} />
      <HomeHub tournament={tournament} posts={posts} upcoming={upcoming} />
      <HomeEvidence slug={tournament?.slug} />
    </>
  )
}
