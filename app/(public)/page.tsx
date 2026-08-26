import { notFound, redirect } from 'next/navigation'
import { getCurrentTournament } from '@/lib/queries/public'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const tournament = await getCurrentTournament()
  if (!tournament) notFound()
  redirect(`/tournaments/${tournament.slug}`)
}
