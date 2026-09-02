import type { TournamentStatus } from './types.ts'

export interface HomeTournamentSignalSource {
  slug: string
  title: string
  season: string
  edition: number
  status: TournamentStatus
}

type HomeTournamentSignalStatus = Extract<
  TournamentStatus,
  'registration' | 'running' | 'postponed'
>

export type HomeTournamentSignal = Omit<HomeTournamentSignalSource, 'status'> & {
  status: HomeTournamentSignalStatus
  statusLabel: '报名阶段' | '进行中' | '延期中'
}

export function homeTournamentSignal(
  tournament: HomeTournamentSignalSource | null,
): HomeTournamentSignal | null {
  if (!tournament) return null

  const source = {
    slug: tournament.slug,
    title: tournament.title,
    season: tournament.season,
    edition: tournament.edition,
  }

  switch (tournament.status) {
    case 'registration':
      return { ...source, status: 'registration', statusLabel: '报名阶段' }
    case 'running':
      return { ...source, status: 'running', statusLabel: '进行中' }
    case 'postponed':
      return { ...source, status: 'postponed', statusLabel: '延期中' }
    default:
      return null
  }
}
