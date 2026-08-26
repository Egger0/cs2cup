import 'server-only'
import { callFunction, selectRow, selectRows } from '../rdb'
import type {
  ClubMember,
  FaqItem,
  Match,
  MatchMap,
  Photo,
  Player,
  Post,
  PublicTeam,
  RuleItem,
  SiteSetting,
  Tournament,
  TournamentStatus,
  VetoAction,
} from '../types'

const REVALIDATE = 300

interface SiteSettingRow {
  id: number
  club_name: string
  club_name_en: string | null
  school: string
  logo_url: string | null
  contact_qq: string | null
  contact_wechat: string | null
  footer_copy: string | null
}

interface TournamentRow {
  id: number
  slug: string
  title: string
  game: string
  season: string
  edition: number
  status: TournamentStatus
  format: string
  team_cap: number
  reg_deadline: string | null
  starts_at: string | null
  accent_color: string | null
  map_pool: string[]
  rules: RuleItem[]
  faqs: FaqItem[]
  hero_eyebrow: string
  hero_top: string
  hero_bottom: string
  lede: string
}

interface TeamRow {
  id: number
  tournament_id: number
  name: string
  tag: string
  captain: string
  dept: string | null
  seed: number | null
}

interface PlayerRow {
  id: number
  team_id: number
  tournament_id: number
  nickname: string
  role: string | null
  is_substitute: boolean
  sort_order: number
}

interface MatchRow {
  id: number
  tournament_id: number
  round: number
  slot: number
  round_label: string
  best_of: number
  team_a_id: number | null
  team_b_id: number | null
  source_match_a_id: number | null
  source_match_b_id: number | null
  score_a: number | null
  score_b: number | null
  winner_team_id: number | null
  scheduled_at: string | null
}

interface PhotoRow {
  id: number
  tournament_id: number
  storage_key: string
  width: number
  height: number
  blur_data_url: string | null
  caption: string | null
  sort_order: number
}

const toSiteSetting = (row: SiteSettingRow): SiteSetting => ({
  id: row.id,
  clubName: row.club_name,
  clubNameEn: row.club_name_en,
  school: row.school,
  logoUrl: row.logo_url,
  contactQq: row.contact_qq,
  contactWechat: row.contact_wechat,
  footerCopy: row.footer_copy,
})

const toTournament = (row: TournamentRow): Tournament => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  game: row.game,
  season: row.season,
  edition: row.edition,
  status: row.status,
  format: row.format,
  teamCap: row.team_cap,
  regDeadline: row.reg_deadline,
  startsAt: row.starts_at,
  accentColor: row.accent_color,
  mapPool: row.map_pool ?? [],
  rules: row.rules ?? [],
  faqs: row.faqs ?? [],
  heroEyebrow: row.hero_eyebrow,
  heroTop: row.hero_top,
  heroBottom: row.hero_bottom,
  lede: row.lede,
})

const toPlayer = (row: PlayerRow): Player => ({
  id: row.id,
  teamId: row.team_id,
  nickname: row.nickname,
  role: row.role,
  isSubstitute: row.is_substitute,
  sortOrder: row.sort_order,
})

const toMatch = (row: MatchRow): Match => ({
  id: row.id,
  tournamentId: row.tournament_id,
  round: row.round,
  slot: row.slot,
  roundLabel: row.round_label,
  bestOf: row.best_of,
  teamAId: row.team_a_id,
  teamBId: row.team_b_id,
  sourceMatchAId: row.source_match_a_id,
  sourceMatchBId: row.source_match_b_id,
  scoreA: row.score_a,
  scoreB: row.score_b,
  winnerTeamId: row.winner_team_id,
  scheduledAt: row.scheduled_at,
})

const toPhoto = (row: PhotoRow): Photo => ({
  id: row.id,
  tournamentId: row.tournament_id,
  storageKey: row.storage_key,
  width: row.width,
  height: row.height,
  blurDataUrl: row.blur_data_url,
  caption: row.caption,
  sortOrder: row.sort_order,
})

export async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (process.env.NEXT_PHASE === 'phase-production-build') return fallback
    throw error
  }
}

export async function getSiteSetting(): Promise<SiteSetting | null> {
  const row = await selectRow<SiteSettingRow>('site_setting', {
    tags: ['site_setting'],
    revalidate: REVALIDATE,
  })
  return row ? toSiteSetting(row) : null
}

export async function listTournaments(): Promise<Tournament[]> {
  const rows = await selectRows<TournamentRow>('tournament', {
    order: 'edition.desc',
    tags: ['tournament'],
    revalidate: REVALIDATE,
  })
  return rows.map(toTournament)
}

export async function getTournament(slug: string): Promise<Tournament | null> {
  const row = await selectRow<TournamentRow>('tournament', {
    filters: { slug: `eq.${slug}` },
    tags: ['tournament', `tournament:${slug}`],
    revalidate: REVALIDATE,
  })
  return row ? toTournament(row) : null
}

export async function getCurrentTournament(): Promise<Tournament | null> {
  const rows = await selectRows<TournamentRow>('tournament', {
    filters: { status: 'neq.finished' },
    order: 'edition.desc',
    limit: 1,
    tags: ['tournament'],
    revalidate: REVALIDATE,
  })
  return rows[0] ? toTournament(rows[0]) : null
}

export async function getPublicTeams(tournamentId: number): Promise<PublicTeam[]> {
  const [teams, players] = await Promise.all([
    selectRows<TeamRow>('team_public', {
      filters: { tournament_id: `eq.${tournamentId}` },
      order: 'seed.asc.nullslast',
      tags: [`teams:${tournamentId}`],
      revalidate: REVALIDATE,
    }),
    selectRows<PlayerRow>('player_public', {
      filters: { tournament_id: `eq.${tournamentId}` },
      order: 'sort_order.asc',
      tags: [`teams:${tournamentId}`],
      revalidate: REVALIDATE,
    }),
  ])

  const byTeam = new Map<number, Player[]>()
  for (const row of players) {
    const list = byTeam.get(row.team_id)
    if (list) list.push(toPlayer(row))
    else byTeam.set(row.team_id, [toPlayer(row)])
  }

  return teams.map(row => ({
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    tag: row.tag,
    captain: row.captain,
    dept: row.dept,
    seed: row.seed,
    players: byTeam.get(row.id) ?? [],
  }))
}

export async function getMatches(tournamentId: number): Promise<Match[]> {
  const rows = await selectRows<MatchRow>('match', {
    filters: { tournament_id: `eq.${tournamentId}` },
    order: 'round.asc,slot.asc',
    tags: [`matches:${tournamentId}`],
    revalidate: REVALIDATE,
  })
  return rows.map(toMatch)
}

export async function getPhotos(tournamentId?: number): Promise<Photo[]> {
  const rows = await selectRows<PhotoRow>('photo', {
    filters: tournamentId ? { tournament_id: `eq.${tournamentId}` } : undefined,
    order: 'sort_order.asc',
    tags: ['photo'],
    revalidate: REVALIDATE,
  })
  return rows.map(toPhoto)
}

interface MatchMapRow {
  id: number
  match_id: number
  pick_order: number
  map_name: string
  action: VetoAction
  chosen_by: 'a' | 'b' | null
  score_a: number | null
  score_b: number | null
  played: boolean
}

export async function getMatchMaps(matchIds: number[]): Promise<MatchMap[]> {
  if (matchIds.length === 0) return []
  const rows = await selectRows<MatchMapRow>('match_map_public', {
    filters: { match_id: `in.(${matchIds.join(',')})` },
    order: 'match_id.asc,pick_order.asc',
    tags: ['match_map'],
    revalidate: REVALIDATE,
  })
  return rows.map(row => ({
    id: row.id,
    matchId: row.match_id,
    pickOrder: row.pick_order,
    mapName: row.map_name,
    action: row.action,
    chosenBy: row.chosen_by,
    scoreA: row.score_a,
    scoreB: row.score_b,
    played: row.played,
  }))
}

interface MemberRow {
  id: number
  name: string
  role: string
  handle: string | null
  intro: string | null
  sort_order: number
}

export async function listMembers(): Promise<ClubMember[]> {
  const rows = await selectRows<MemberRow>('club_member', {
    order: 'sort_order.asc',
    tags: ['club_member'],
    revalidate: REVALIDATE,
  })
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    role: row.role,
    handle: row.handle,
    intro: row.intro,
    sortOrder: row.sort_order,
  }))
}

interface PostRow {
  id: number
  slug: string
  title: string
  summary: string
  body: string
  published_at: string
  pinned: boolean
}

export async function listPosts(limit?: number): Promise<Post[]> {
  const rows = await selectRows<PostRow>('post', {
    order: 'pinned.desc,published_at.desc',
    limit,
    tags: ['post'],
    revalidate: REVALIDATE,
  })
  return rows.map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    publishedAt: row.published_at,
    pinned: row.pinned,
  }))
}

export interface RegistrationStatus {
  cap: number
  taken: number
  open: boolean
}

export function getRegistrationStatus(slug: string) {
  return callFunction<RegistrationStatus>('registration_status', { p_slug: slug })
}
