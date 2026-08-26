export type TournamentStatus =
  | 'draft'
  | 'registration'
  | 'running'
  | 'finished'
  | 'postponed'

export type TeamStatus = 'pending' | 'approved' | 'rejected'

export interface SiteSetting {
  id: number
  clubName: string
  clubNameEn: string | null
  school: string
  logoUrl: string | null
  contactQq: string | null
  contactWechat: string | null
  footerCopy: string | null
}

export interface RuleItem {
  label: string
  title: string
  body: string
}

export interface FaqItem {
  question: string
  answer: string
}

export interface Tournament {
  id: number
  slug: string
  title: string
  game: string
  season: string
  edition: number
  status: TournamentStatus
  format: string
  teamCap: number
  regDeadline: string | null
  startsAt: string | null
  accentColor: string | null
  mapPool: string[]
  rules: RuleItem[]
  faqs: FaqItem[]
  heroEyebrow: string
  heroTop: string
  heroBottom: string
  lede: string
}

export interface Player {
  id: number
  teamId: number
  nickname: string
  role: string | null
  isSubstitute: boolean
  sortOrder: number
}

export interface PublicTeam {
  id: number
  tournamentId: number
  name: string
  tag: string
  captain: string
  dept: string | null
  seed: number | null
  players: Player[]
}

export interface Team extends PublicTeam {
  contact: string
  note: string | null
  status: TeamStatus
  createdAt: string
}

export interface Match {
  id: number
  tournamentId: number
  round: number
  slot: number
  roundLabel: string
  bestOf: number
  teamAId: number | null
  teamBId: number | null
  sourceMatchAId: number | null
  sourceMatchBId: number | null
  scoreA: number | null
  scoreB: number | null
  winnerTeamId: number | null
  scheduledAt: string | null
}

export interface Photo {
  id: number
  tournamentId: number
  storageKey: string
  width: number
  height: number
  blurDataUrl: string | null
  caption: string | null
  sortOrder: number
}

export type VetoAction = 'ban' | 'pick' | 'decider'

export interface MatchMap {
  id: number
  matchId: number
  pickOrder: number
  mapName: string
  action: VetoAction
  chosenBy: 'a' | 'b' | null
  scoreA: number | null
  scoreB: number | null
  played: boolean
}

export interface ClubMember {
  id: number
  name: string
  role: string
  handle: string | null
  intro: string | null
  sortOrder: number
}

export interface Post {
  id: number
  slug: string
  title: string
  summary: string
  body: string
  publishedAt: string
  pinned: boolean
}
