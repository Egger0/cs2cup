import { HomeEvidence } from '@/components/home/HomeEvidence'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeIndex } from '@/components/home/HomeIndex'
import { HomeReveal } from '@/components/home/HomeReveal'
import { homeTournamentSignal } from '@/lib/home-tournament-signal'
import { getCurrentTournament, safely } from '@/lib/queries/public'

export default async function HomePage() {
  const tournament = await safely(getCurrentTournament, null)

  return (
    <>
      <HomeHero signal={homeTournamentSignal(tournament)} />
      <HomeReveal />
      <HomeEvidence />
      <HomeIndex />
    </>
  )
}
