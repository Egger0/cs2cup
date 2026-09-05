import { HomeEvidence } from '@/components/home/HomeEvidence'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeHub } from '@/components/home/HomeHub'
import { HomeIndex } from '@/components/home/HomeIndex'
import { HomeReveal } from '@/components/home/HomeReveal'
import { homeTournamentSignal } from '@/lib/home-tournament-signal'
import { getCurrentTournament, listPosts, safely } from '@/lib/queries/public'

export const metadata = { alternates: { canonical: '/' } }

export default async function HomePage() {
  const [tournament, posts] = await Promise.all([
    safely(getCurrentTournament, null),
    safely(() => listPosts(2), []),
  ])

  return (
    <>
      <HomeHero signal={homeTournamentSignal(tournament)} />
      <HomeReveal />
      <HomeHub tournament={tournament} posts={posts} />
      <HomeEvidence slug={tournament?.slug} />
      <HomeIndex />
    </>
  )
}
