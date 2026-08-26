import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import { getCurrentTournament } from '@/lib/queries/public'

export const revalidate = 300

export default async function Home() {
  const tournament = await getCurrentTournament()
  if (!tournament) notFound()
  redirect(`/tournaments/${tournament.slug}`)
}
