import 'server-only'
import { callPublicFunction, selectPublicRow, selectPublicRows } from '../rdb'
import { d1UtcTimestampToIso } from '../datetime'
import type {
  ClubMember,
  GuestbookMessage,
  Game,
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

const SITE_SETTING_SELECT =
  'id,club_name,club_name_en,school,logo_url,contact_qq,contact_wechat,footer_copy'
const TOURNAMENT_SELECT =
  'id,slug,title,game_id,game(slug,name),season,edition,status,format,team_cap,' +
  'reg_deadline,starts_at,accent_color,map_pool,rules,faqs,hero_eyebrow,hero_top,' +
  'hero_bottom,lede,champion_name,champion_note'
const TEAM_SELECT = 'id,tournament_id,name,tag,captain,dept,seed'
const PLAYER_SELECT =
  'id,team_id,tournament_id,nickname,role,is_substitute,sort_order'
const MATCH_SELECT =
  'id,tournament_id,round,slot,round_label,best_of,team_a_id,team_b_id,' +
  'source_match_a_id,source_match_b_id,score_a,score_b,winner_team_id,scheduled_at'
const PHOTO_SELECT =
  'id,tournament_id,storage_key,width,height,blur_data_url,caption,sort_order'
const MATCH_MAP_SELECT =
  'id,match_id,pick_order,map_name,action,chosen_by,score_a,score_b,played'
const MEMBER_SELECT = 'id,name,role,handle,intro,sort_order'
const GUESTBOOK_SELECT = 'id,name,body,created_at'
const POST_SELECT = 'id,game_id,slug,title,summary,body,published_at,pinned'
const GAME_SELECT =
  'id,slug,name,name_en,accent_color,tagline,description,format_note,sort_order,active'

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
  game_id: number | null
  game: { slug: string; name: string } | null
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
  champion_name: string | null
  champion_note: string | null
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
  gameId: row.game_id,
  gameSlug: row.game?.slug ?? null,
  gameName: row.game?.name ?? null,
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
  championName: row.champion_name,
  championNote: row.champion_note,
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
    if (
      process.env.NEXT_PHASE === 'phase-production-build' ||
      process.env.HOME_PREVIEW_COUNTDOWN === '1'
    ) return fallback
    throw error
  }
}

export async function getSiteSetting(): Promise<SiteSetting | null> {
  const row = await selectPublicRow<SiteSettingRow>('site_setting', {
    select: SITE_SETTING_SELECT,
  })
  return row ? toSiteSetting(row) : null
}

export async function listTournaments(): Promise<Tournament[]> {
  const rows = await selectPublicRows<TournamentRow>('tournament_public', {
    select: TOURNAMENT_SELECT,
    order: 'season.desc,edition.desc',
  })
  return rows.map(toTournament)
}

export async function getTournament(slug: string): Promise<Tournament | null> {
  const row = await selectPublicRow<TournamentRow>('tournament_public', {
    select: TOURNAMENT_SELECT,
    filters: { slug: `eq.${slug}` },
  })
  return row ? toTournament(row) : null
}

export async function getCurrentTournament(): Promise<Tournament | null> {
  const rows = await selectPublicRows<TournamentRow>('tournament_public', {
    select: TOURNAMENT_SELECT,
    filters: { status: 'neq.finished' },
    order: 'season.desc,edition.desc',
    limit: 1,
  })
  return rows[0] ? toTournament(rows[0]) : null
}

export async function getPublicTeams(tournamentId: number): Promise<PublicTeam[]> {
  const [teams, players] = await Promise.all([
    selectPublicRows<TeamRow>('team_public', {
      select: TEAM_SELECT,
      filters: { tournament_id: `eq.${tournamentId}` },
      order: 'seed.asc.nullslast',
    }),
    selectPublicRows<PlayerRow>('player_public', {
      select: PLAYER_SELECT,
      filters: { tournament_id: `eq.${tournamentId}` },
      order: 'sort_order.asc',
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
  const rows = await selectPublicRows<MatchRow>('match_public', {
    select: MATCH_SELECT,
    filters: { tournament_id: `eq.${tournamentId}` },
    order: 'round.asc,slot.asc',
  })
  return rows.map(toMatch)
}

export async function getPhotos(tournamentId?: number): Promise<Photo[]> {
  const rows = await selectPublicRows<PhotoRow>('photo_public', {
    select: PHOTO_SELECT,
    filters: tournamentId ? { tournament_id: `eq.${tournamentId}` } : undefined,
    order: 'sort_order.asc',
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
  const rows = await selectPublicRows<MatchMapRow>('match_map_public', {
    select: MATCH_MAP_SELECT,
    filters: { match_id: `in.(${matchIds.join(',')})` },
    order: 'match_id.asc,pick_order.asc',
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
  const rows = await selectPublicRows<MemberRow>('club_member', {
    select: MEMBER_SELECT,
    order: 'sort_order.asc',
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

interface GuestbookRow {
  id: number
  name: string
  body: string
  created_at: string
}

export async function listGuestbookMessages(limit = 50): Promise<GuestbookMessage[]> {
  const rows = await selectPublicRows<GuestbookRow>('guestbook_public', {
    select: GUESTBOOK_SELECT,
    order: 'created_at.desc,id.desc',
    limit,
  })
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    body: row.body,
    status: 'published',
    createdAt: d1UtcTimestampToIso(row.created_at) ?? row.created_at,
  }))
}

interface PostRow {
  id: number
  game_id: number | null
  slug: string
  title: string
  summary: string
  body: string
  published_at: string
  pinned: boolean
}

export async function listPosts(limit?: number): Promise<Post[]> {
  const rows = await selectPublicRows<PostRow>('post', {
    select: POST_SELECT,
    order: 'pinned.desc,published_at.desc',
    limit,
  })
  return rows.map(row => ({
    id: row.id,
    gameId: row.game_id,
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
  return callPublicFunction<RegistrationStatus>('registration_status', { p_slug: slug })
}

interface GameRow {
  id: number
  slug: string
  name: string
  name_en: string | null
  accent_color: string | null
  tagline: string | null
  description: string | null
  format_note: string | null
  sort_order: number
  active: boolean
}

const toGame = (row: GameRow): Game => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  nameEn: row.name_en,
  accentColor: row.accent_color,
  tagline: row.tagline,
  description: row.description,
  formatNote: row.format_note,
  sortOrder: row.sort_order,
  active: row.active,
})

export async function listGames(): Promise<Game[]> {
  const rows = await selectPublicRows<GameRow>('game', {
    select: GAME_SELECT,
    order: 'sort_order.asc',
  })
  return rows.map(toGame)
}

export async function getGame(slug: string): Promise<Game | null> {
  const row = await selectPublicRow<GameRow>('game', {
    select: GAME_SELECT,
    filters: { slug: `eq.${slug}` },
  })
  return row ? toGame(row) : null
}

export async function getPost(slug: string): Promise<Post | null> {
  const row = await selectPublicRow<PostRow>('post', {
    select: POST_SELECT,
    filters: { slug: `eq.${slug}` },
  })
  if (!row) return null
  return {
    id: row.id,
    gameId: row.game_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    publishedAt: row.published_at,
    pinned: row.pinned,
  }
}

export async function listHonours() {
  const tournaments = await listTournaments()
  const finished = tournaments.filter(tournament => tournament.status === 'finished')

  const withChampions = await Promise.all(
    finished.map(async tournament => {
      if (tournament.championName) {
        return { tournament, champion: tournament.championName }
      }
      const [matches, teams] = await Promise.all([
        getMatches(tournament.id),
        getPublicTeams(tournament.id),
      ])
      const finalRound = matches.reduce((best, match) => Math.max(best, match.round), -1)
      const decider = matches.find(match => match.round === finalRound)
      const winner = decider?.winnerTeamId
        ? teams.find(team => team.id === decider.winnerTeamId)
        : undefined
      return { tournament, champion: winner?.name ?? null }
    }),
  )

  return withChampions
}

export interface SearchHit {
  kind: 'tournament' | 'team' | 'post' | 'game'
  title: string
  subtitle: string
  href: string
}

export async function search(query: string): Promise<SearchHit[]> {
  const term = query.trim()
  if (term.length === 0) return []
  const like = `ilike.*${term}*`

  const [games, tournaments, posts] = await Promise.all([
    selectPublicRows<GameRow>('game', {
      select: GAME_SELECT,
      filters: { or: `(name.${like},name_en.${like})` },
      limit: 8,
    }),
    selectPublicRows<TournamentRow>('tournament_public', {
      select: TOURNAMENT_SELECT,
      filters: { or: `(title.${like},season.${like})` },
      limit: 8,
    }),
    selectPublicRows<PostRow>('post', {
      select: POST_SELECT,
      filters: { or: `(title.${like},summary.${like},body.${like})` },
      limit: 8,
    }),
  ])

  const teamHits: SearchHit[] = []
  const allTournaments = await listTournaments()
  const teams = await selectPublicRows<{
    id: number
    tournament_id: number
    name: string
    tag: string
  }>(
    'team_public',
    {
      select: 'id,tournament_id,name,tag',
      filters: { or: `(name.${like},tag.${like})` },
      limit: 10,
    },
  )
  for (const team of teams) {
    const tournament = allTournaments.find(entry => entry.id === team.tournament_id)
    if (!tournament) continue
    teamHits.push({
      kind: 'team',
      title: team.name,
      subtitle: `${team.tag} · ${tournament.title}`,
      href: `/tournaments/${tournament.slug}/teams/${team.tag}`,
    })
  }

  return [
    ...games.map(row => ({
      kind: 'game' as const,
      title: row.name,
      subtitle: row.name_en ?? '项目',
      href: `/games/${row.slug}`,
    })),
    ...tournaments.map(row => ({
      kind: 'tournament' as const,
      title: row.title,
      subtitle: `${row.season} · 第 ${row.edition} 届`,
      href: `/tournaments/${row.slug}`,
    })),
    ...teamHits,
    ...posts.map(row => ({
      kind: 'post' as const,
      title: row.title,
      subtitle: new Date(row.published_at).toLocaleDateString('zh-CN'),
      href: `/news/${row.slug}`,
    })),
  ]
}
