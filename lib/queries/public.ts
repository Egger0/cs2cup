import 'server-only'

import {
  DatabaseError,
  database,
  databaseOperation,
  isoDatabaseTimestamp,
  nullableIsoDatabaseTimestamp,
  safeDatabaseInteger,
} from '../database'
import type {
  ClubMember,
  FaqItem,
  Game,
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

type DatabaseInteger = number | string | bigint
type DatabaseTimestamp = string | Date

interface SiteSettingRow {
  id: DatabaseInteger
  club_name: string
  club_name_en: string | null
  school: string
  logo_url: string | null
  contact_qq: string | null
  contact_wechat: string | null
  footer_copy: string | null
}

interface TournamentRow {
  id: DatabaseInteger
  slug: string
  title: string
  game_id: DatabaseInteger | null
  game_slug: string | null
  game_name: string | null
  season: string
  edition: DatabaseInteger
  status: TournamentStatus
  format: string
  team_cap: DatabaseInteger
  reg_deadline: DatabaseTimestamp | null
  starts_at: DatabaseTimestamp | null
  accent_color: string | null
  map_pool: string[] | null
  rules: RuleItem[] | null
  faqs: FaqItem[] | null
  hero_eyebrow: string
  hero_top: string
  hero_bottom: string
  lede: string
  champion_name: string | null
  champion_note: string | null
}

interface TeamRow {
  id: DatabaseInteger
  tournament_id: DatabaseInteger
  name: string
  tag: string
  captain: string
  dept: string | null
  seed: DatabaseInteger | null
}

interface PlayerRow {
  id: DatabaseInteger
  team_id: DatabaseInteger
  tournament_id: DatabaseInteger
  nickname: string
  role: string | null
  is_substitute: boolean
  sort_order: DatabaseInteger
}

interface MatchRow {
  id: DatabaseInteger
  tournament_id: DatabaseInteger
  round: DatabaseInteger
  slot: DatabaseInteger
  round_label: string
  best_of: DatabaseInteger
  team_a_id: DatabaseInteger | null
  team_b_id: DatabaseInteger | null
  source_match_a_id: DatabaseInteger | null
  source_match_b_id: DatabaseInteger | null
  score_a: DatabaseInteger | null
  score_b: DatabaseInteger | null
  winner_team_id: DatabaseInteger | null
  scheduled_at: DatabaseTimestamp | null
}

interface PhotoRow {
  id: DatabaseInteger
  tournament_id: DatabaseInteger
  storage_key: string
  width: DatabaseInteger
  height: DatabaseInteger
  blur_data_url: string | null
  caption: string | null
  sort_order: DatabaseInteger
}

interface MatchMapRow {
  id: DatabaseInteger
  match_id: DatabaseInteger
  pick_order: DatabaseInteger
  map_name: string
  action: VetoAction
  chosen_by: 'a' | 'b' | null
  score_a: DatabaseInteger | null
  score_b: DatabaseInteger | null
  played: boolean
}

interface MemberRow {
  id: DatabaseInteger
  name: string
  role: string
  handle: string | null
  intro: string | null
  sort_order: DatabaseInteger
}

interface PostRow {
  id: DatabaseInteger
  game_id: DatabaseInteger | null
  slug: string
  title: string
  summary: string
  body: string
  published_at: DatabaseTimestamp
  pinned: boolean
}

interface GameRow {
  id: DatabaseInteger
  slug: string
  name: string
  name_en: string | null
  accent_color: string | null
  tagline: string | null
  description: string | null
  format_note: string | null
  sort_order: DatabaseInteger
  active: boolean
}

const nullableDatabaseInteger = (value: unknown, field: string) =>
  value === null ? null : safeDatabaseInteger(value, field)

const toSiteSetting = (row: SiteSettingRow): SiteSetting => ({
  id: safeDatabaseInteger(row.id, 'site-setting.id'),
  clubName: row.club_name,
  clubNameEn: row.club_name_en,
  school: row.school,
  logoUrl: row.logo_url,
  contactQq: row.contact_qq,
  contactWechat: row.contact_wechat,
  footerCopy: row.footer_copy,
})

const toTournament = (row: TournamentRow): Tournament => ({
  id: safeDatabaseInteger(row.id, 'tournament.id'),
  slug: row.slug,
  title: row.title,
  gameId: nullableDatabaseInteger(row.game_id, 'tournament.game-id'),
  gameSlug: row.game_slug,
  gameName: row.game_name,
  season: row.season,
  edition: safeDatabaseInteger(row.edition, 'tournament.edition'),
  status: row.status,
  format: row.format,
  teamCap: safeDatabaseInteger(row.team_cap, 'tournament.team-cap'),
  regDeadline: nullableIsoDatabaseTimestamp(row.reg_deadline, 'tournament.reg-deadline'),
  startsAt: nullableIsoDatabaseTimestamp(row.starts_at, 'tournament.starts-at'),
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
  id: safeDatabaseInteger(row.id, 'player.id'),
  teamId: safeDatabaseInteger(row.team_id, 'player.team-id'),
  nickname: row.nickname,
  role: row.role,
  isSubstitute: row.is_substitute,
  sortOrder: safeDatabaseInteger(row.sort_order, 'player.sort-order'),
})

const toMatch = (row: MatchRow): Match => ({
  id: safeDatabaseInteger(row.id, 'match.id'),
  tournamentId: safeDatabaseInteger(row.tournament_id, 'match.tournament-id'),
  round: safeDatabaseInteger(row.round, 'match.round'),
  slot: safeDatabaseInteger(row.slot, 'match.slot'),
  roundLabel: row.round_label,
  bestOf: safeDatabaseInteger(row.best_of, 'match.best-of'),
  teamAId: nullableDatabaseInteger(row.team_a_id, 'match.team-a-id'),
  teamBId: nullableDatabaseInteger(row.team_b_id, 'match.team-b-id'),
  sourceMatchAId: nullableDatabaseInteger(row.source_match_a_id, 'match.source-match-a-id'),
  sourceMatchBId: nullableDatabaseInteger(row.source_match_b_id, 'match.source-match-b-id'),
  scoreA: nullableDatabaseInteger(row.score_a, 'match.score-a'),
  scoreB: nullableDatabaseInteger(row.score_b, 'match.score-b'),
  winnerTeamId: nullableDatabaseInteger(row.winner_team_id, 'match.winner-team-id'),
  scheduledAt: nullableIsoDatabaseTimestamp(row.scheduled_at, 'match.scheduled-at'),
})

const toPhoto = (row: PhotoRow): Photo => ({
  id: safeDatabaseInteger(row.id, 'photo.id'),
  tournamentId: safeDatabaseInteger(row.tournament_id, 'photo.tournament-id'),
  storageKey: row.storage_key,
  width: safeDatabaseInteger(row.width, 'photo.width'),
  height: safeDatabaseInteger(row.height, 'photo.height'),
  blurDataUrl: row.blur_data_url,
  caption: row.caption,
  sortOrder: safeDatabaseInteger(row.sort_order, 'photo.sort-order'),
})

const toPost = (row: PostRow): Post => ({
  id: safeDatabaseInteger(row.id, 'post.id'),
  gameId: nullableDatabaseInteger(row.game_id, 'post.game-id'),
  slug: row.slug,
  title: row.title,
  summary: row.summary,
  body: row.body,
  publishedAt: isoDatabaseTimestamp(row.published_at, 'post.published-at'),
  pinned: row.pinned,
})

const toGame = (row: GameRow): Game => ({
  id: safeDatabaseInteger(row.id, 'game.id'),
  slug: row.slug,
  name: row.name,
  nameEn: row.name_en,
  accentColor: row.accent_color,
  tagline: row.tagline,
  description: row.description,
  formatNote: row.format_note,
  sortOrder: safeDatabaseInteger(row.sort_order, 'game.sort-order'),
  active: row.active,
})

function databaseLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseError('decode:query-limit', null, false)
  }
  return value
}

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

export function getSiteSetting(): Promise<SiteSetting | null> {
  return databaseOperation('public:get-site-setting', async () => {
    const sql = database()
    const rows = await sql<SiteSettingRow[]>`
      select
        setting.id,
        setting.club_name,
        setting.club_name_en,
        setting.school,
        setting.logo_url,
        setting.contact_qq,
        setting.contact_wechat,
        setting.footer_copy
      from public.site_setting setting
      order by setting.id
      limit 1
    `
    return rows[0] ? toSiteSetting(rows[0]) : null
  })
}

export function listTournaments(): Promise<Tournament[]> {
  return databaseOperation('public:list-tournaments', async () => {
    const sql = database()
    const rows = await sql<TournamentRow[]>`
      select
        tournament.id,
        tournament.slug,
        tournament.title,
        tournament.game_id,
        game.slug as game_slug,
        game.name as game_name,
        tournament.season,
        tournament.edition,
        tournament.status,
        tournament.format,
        tournament.team_cap,
        tournament.reg_deadline,
        tournament.starts_at,
        tournament.accent_color,
        tournament.map_pool,
        tournament.rules,
        tournament.faqs,
        tournament.hero_eyebrow,
        tournament.hero_top,
        tournament.hero_bottom,
        tournament.lede,
        tournament.champion_name,
        tournament.champion_note
      from public.tournament tournament
      left join public.game game
        on game.id = tournament.game_id
       and game.active is true
      where tournament.status <> 'draft'
      order by tournament.season desc, tournament.edition desc
    `
    return rows.map(toTournament)
  })
}

export function getTournament(slug: string): Promise<Tournament | null> {
  return databaseOperation('public:get-tournament', async () => {
    const sql = database()
    const rows = await sql<TournamentRow[]>`
      select
        tournament.id,
        tournament.slug,
        tournament.title,
        tournament.game_id,
        game.slug as game_slug,
        game.name as game_name,
        tournament.season,
        tournament.edition,
        tournament.status,
        tournament.format,
        tournament.team_cap,
        tournament.reg_deadline,
        tournament.starts_at,
        tournament.accent_color,
        tournament.map_pool,
        tournament.rules,
        tournament.faqs,
        tournament.hero_eyebrow,
        tournament.hero_top,
        tournament.hero_bottom,
        tournament.lede,
        tournament.champion_name,
        tournament.champion_note
      from public.tournament tournament
      left join public.game game
        on game.id = tournament.game_id
       and game.active is true
      where tournament.slug = ${slug}
        and tournament.status <> 'draft'
      limit 1
    `
    return rows[0] ? toTournament(rows[0]) : null
  })
}

export function getCurrentTournament(): Promise<Tournament | null> {
  return databaseOperation('public:get-current-tournament', async () => {
    const sql = database()
    const rows = await sql<TournamentRow[]>`
      select
        tournament.id,
        tournament.slug,
        tournament.title,
        tournament.game_id,
        game.slug as game_slug,
        game.name as game_name,
        tournament.season,
        tournament.edition,
        tournament.status,
        tournament.format,
        tournament.team_cap,
        tournament.reg_deadline,
        tournament.starts_at,
        tournament.accent_color,
        tournament.map_pool,
        tournament.rules,
        tournament.faqs,
        tournament.hero_eyebrow,
        tournament.hero_top,
        tournament.hero_bottom,
        tournament.lede,
        tournament.champion_name,
        tournament.champion_note
      from public.tournament tournament
      left join public.game game
        on game.id = tournament.game_id
       and game.active is true
      where tournament.status not in ('draft', 'finished')
      order by tournament.season desc, tournament.edition desc
      limit 1
    `
    return rows[0] ? toTournament(rows[0]) : null
  })
}

export function getPublicTeams(tournamentId: number): Promise<PublicTeam[]> {
  return databaseOperation('public:get-tournament-teams', async () => {
    const sql = database()
    const id = safeDatabaseInteger(tournamentId, 'tournament-id')
    const [teams, players] = await Promise.all([
      sql<TeamRow[]>`
        select
          team.id,
          team.tournament_id,
          team.name,
          team.tag,
          team.captain,
          team.dept,
          team.seed
        from public.team_public team
        join public.tournament tournament on tournament.id = team.tournament_id
        where team.tournament_id = ${id}
          and tournament.status <> 'draft'
        order by team.seed asc nulls last, team.id asc
      `,
      sql<PlayerRow[]>`
        select
          player.id,
          player.team_id,
          player.tournament_id,
          player.nickname,
          player.role,
          player.is_substitute,
          player.sort_order
        from public.player_public player
        join public.tournament tournament on tournament.id = player.tournament_id
        where player.tournament_id = ${id}
          and tournament.status <> 'draft'
        order by player.team_id asc, player.sort_order asc, player.id asc
      `,
    ])

    const byTeam = new Map<number, Player[]>()
    for (const row of players) {
      const player = toPlayer(row)
      const list = byTeam.get(player.teamId)
      if (list) list.push(player)
      else byTeam.set(player.teamId, [player])
    }

    return teams.map(row => {
      const teamId = safeDatabaseInteger(row.id, 'team.id')
      return {
        id: teamId,
        tournamentId: safeDatabaseInteger(row.tournament_id, 'team.tournament-id'),
        name: row.name,
        tag: row.tag,
        captain: row.captain,
        dept: row.dept,
        seed: nullableDatabaseInteger(row.seed, 'team.seed'),
        players: byTeam.get(teamId) ?? [],
      }
    })
  })
}

export function getMatches(tournamentId: number): Promise<Match[]> {
  return databaseOperation('public:get-tournament-matches', async () => {
    const sql = database()
    const id = safeDatabaseInteger(tournamentId, 'tournament-id')
    const rows = await sql<MatchRow[]>`
      select
        match.id,
        match.tournament_id,
        match.round,
        match.slot,
        match.round_label,
        match.best_of,
        match.team_a_id,
        match.team_b_id,
        match.source_match_a_id,
        match.source_match_b_id,
        match.score_a,
        match.score_b,
        match.winner_team_id,
        match.scheduled_at
      from public.match match
      join public.tournament tournament on tournament.id = match.tournament_id
      where match.tournament_id = ${id}
        and tournament.status <> 'draft'
      order by match.round asc, match.slot asc
    `
    return rows.map(toMatch)
  })
}

export function getPhotos(tournamentId?: number): Promise<Photo[]> {
  return databaseOperation('public:get-photos', async () => {
    const sql = database()
    const rows = tournamentId === undefined
      ? await sql<PhotoRow[]>`
          select
            photo.id,
            photo.tournament_id,
            photo.storage_key,
            photo.width,
            photo.height,
            photo.blur_data_url,
            photo.caption,
            photo.sort_order
          from public.photo_public photo
          join public.tournament tournament on tournament.id = photo.tournament_id
          where tournament.status <> 'draft'
          order by photo.sort_order asc, photo.id asc
        `
      : await sql<PhotoRow[]>`
          select
            photo.id,
            photo.tournament_id,
            photo.storage_key,
            photo.width,
            photo.height,
            photo.blur_data_url,
            photo.caption,
            photo.sort_order
          from public.photo_public photo
          join public.tournament tournament on tournament.id = photo.tournament_id
          where photo.tournament_id = ${safeDatabaseInteger(tournamentId, 'tournament-id')}
            and tournament.status <> 'draft'
          order by photo.sort_order asc, photo.id asc
        `
    return rows.map(toPhoto)
  })
}

export function getMatchMaps(matchIds: number[]): Promise<MatchMap[]> {
  if (matchIds.length === 0) return Promise.resolve([])

  return databaseOperation('public:get-match-maps', async () => {
    const sql = database()
    const ids = Array.from(new Set(
      matchIds.map(id => safeDatabaseInteger(id, 'match-id')),
    ))
    const rows = await sql<MatchMapRow[]>`
      select
        map.id,
        map.match_id,
        map.pick_order,
        map.map_name,
        map.action,
        map.chosen_by,
        map.score_a,
        map.score_b,
        map.played
      from public.match_map_public map
      join public.match match on match.id = map.match_id
      join public.tournament tournament on tournament.id = match.tournament_id
      where map.match_id in ${sql(ids)}
        and tournament.status <> 'draft'
      order by map.match_id asc, map.pick_order asc
    `
    return rows.map(row => ({
      id: safeDatabaseInteger(row.id, 'match-map.id'),
      matchId: safeDatabaseInteger(row.match_id, 'match-map.match-id'),
      pickOrder: safeDatabaseInteger(row.pick_order, 'match-map.pick-order'),
      mapName: row.map_name,
      action: row.action,
      chosenBy: row.chosen_by,
      scoreA: nullableDatabaseInteger(row.score_a, 'match-map.score-a'),
      scoreB: nullableDatabaseInteger(row.score_b, 'match-map.score-b'),
      played: row.played,
    }))
  })
}

export function listMembers(): Promise<ClubMember[]> {
  return databaseOperation('public:list-members', async () => {
    const sql = database()
    const rows = await sql<MemberRow[]>`
      select
        member.id,
        member.name,
        member.role,
        member.handle,
        member.intro,
        member.sort_order
      from public.club_member member
      order by member.sort_order asc, member.id asc
    `
    return rows.map(row => ({
      id: safeDatabaseInteger(row.id, 'club-member.id'),
      name: row.name,
      role: row.role,
      handle: row.handle,
      intro: row.intro,
      sortOrder: safeDatabaseInteger(row.sort_order, 'club-member.sort-order'),
    }))
  })
}

export function listPosts(limit?: number): Promise<Post[]> {
  return databaseOperation('public:list-posts', async () => {
    const sql = database()
    const rows = limit === undefined
      ? await sql<PostRow[]>`
          select
            post.id,
            post.game_id,
            post.slug,
            post.title,
            post.summary,
            post.body,
            post.published_at,
            post.pinned
          from public.post post
          where post.published_at <= current_timestamp
          order by post.pinned desc, post.published_at desc
        `
      : await sql<PostRow[]>`
          select
            post.id,
            post.game_id,
            post.slug,
            post.title,
            post.summary,
            post.body,
            post.published_at,
            post.pinned
          from public.post post
          where post.published_at <= current_timestamp
          order by post.pinned desc, post.published_at desc
          limit ${databaseLimit(limit)}
        `
    return rows.map(toPost)
  })
}

export interface RegistrationStatus {
  cap: number
  taken: number
  open: boolean
}

interface RegistrationStatusRow {
  result: {
    cap?: unknown
    taken?: unknown
    open?: unknown
  } | null
}

export function getRegistrationStatus(slug: string): Promise<RegistrationStatus> {
  return databaseOperation('public:get-registration-status', async () => {
    const sql = database()
    const rows = await sql<RegistrationStatusRow[]>`
      select public.registration_status(${slug}::text) as result
    `
    const result = rows[0]?.result
    if (!result || typeof result.open !== 'boolean') {
      throw new DatabaseError('decode:registration-status', null, false)
    }
    return {
      cap: safeDatabaseInteger(result.cap, 'registration-status.cap'),
      taken: safeDatabaseInteger(result.taken, 'registration-status.taken'),
      open: result.open,
    }
  })
}

export function listGames(): Promise<Game[]> {
  return databaseOperation('public:list-games', async () => {
    const sql = database()
    const rows = await sql<GameRow[]>`
      select
        game.id,
        game.slug,
        game.name,
        game.name_en,
        game.accent_color,
        game.tagline,
        game.description,
        game.format_note,
        game.sort_order,
        game.active
      from public.game game
      where game.active is true
      order by game.sort_order asc, game.id asc
    `
    return rows.map(toGame)
  })
}

export function getGame(slug: string): Promise<Game | null> {
  return databaseOperation('public:get-game', async () => {
    const sql = database()
    const rows = await sql<GameRow[]>`
      select
        game.id,
        game.slug,
        game.name,
        game.name_en,
        game.accent_color,
        game.tagline,
        game.description,
        game.format_note,
        game.sort_order,
        game.active
      from public.game game
      where game.slug = ${slug}
        and game.active is true
      limit 1
    `
    return rows[0] ? toGame(rows[0]) : null
  })
}

export function getPost(slug: string): Promise<Post | null> {
  return databaseOperation('public:get-post', async () => {
    const sql = database()
    const rows = await sql<PostRow[]>`
      select
        post.id,
        post.game_id,
        post.slug,
        post.title,
        post.summary,
        post.body,
        post.published_at,
        post.pinned
      from public.post post
      where post.slug = ${slug}
        and post.published_at <= current_timestamp
      limit 1
    `
    return rows[0] ? toPost(rows[0]) : null
  })
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

interface SearchGameRow {
  slug: string
  name: string
  name_en: string | null
}

interface SearchTournamentRow {
  slug: string
  title: string
  season: string
  edition: DatabaseInteger
}

interface SearchPostRow {
  slug: string
  title: string
  published_at: DatabaseTimestamp
}

interface SearchTeamRow {
  name: string
  tag: string
  tournament_slug: string
  tournament_title: string
}

export function search(query: string): Promise<SearchHit[]> {
  const term = query.trim()
  if (term.length === 0 || term.length > 100) return Promise.resolve([])

  return databaseOperation('public:search', async () => {
    const sql = database()
    const pattern = `%${term}%`
    const [games, tournaments, posts, teams] = await Promise.all([
      sql<SearchGameRow[]>`
        select game.slug, game.name, game.name_en
        from public.game game
        where game.active is true
          and (game.name ilike ${pattern} or game.name_en ilike ${pattern})
        limit 8
      `,
      sql<SearchTournamentRow[]>`
        select tournament.slug, tournament.title, tournament.season, tournament.edition
        from public.tournament tournament
        where tournament.status <> 'draft'
          and (tournament.title ilike ${pattern} or tournament.season ilike ${pattern})
        limit 8
      `,
      sql<SearchPostRow[]>`
        select post.slug, post.title, post.published_at
        from public.post post
        where post.published_at <= current_timestamp
          and (
            post.title ilike ${pattern}
            or post.summary ilike ${pattern}
            or post.body ilike ${pattern}
          )
        limit 8
      `,
      sql<SearchTeamRow[]>`
        select
          team.name,
          team.tag,
          tournament.slug as tournament_slug,
          tournament.title as tournament_title
        from public.team_public team
        join public.tournament tournament on tournament.id = team.tournament_id
        where tournament.status <> 'draft'
          and (team.name ilike ${pattern} or team.tag ilike ${pattern})
        limit 10
      `,
    ])

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
        subtitle: `${row.season} · 第 ${safeDatabaseInteger(row.edition, 'tournament.edition')} 届`,
        href: `/tournaments/${row.slug}`,
      })),
      ...teams.map(row => ({
        kind: 'team' as const,
        title: row.name,
        subtitle: `${row.tag} · ${row.tournament_title}`,
        href: `/tournaments/${row.tournament_slug}/teams/${row.tag}`,
      })),
      ...posts.map(row => ({
        kind: 'post' as const,
        title: row.title,
        subtitle: new Date(
          isoDatabaseTimestamp(row.published_at, 'post.published-at'),
        ).toLocaleDateString('zh-CN'),
        href: `/news/${row.slug}`,
      })),
    ]
  })
}
