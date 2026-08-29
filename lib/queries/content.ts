import 'server-only'

import { requireAdmin } from '../auth'
import {
  database,
  databaseOperation,
  isoDatabaseTimestamp,
  nullableIsoDatabaseTimestamp,
  safeDatabaseInteger,
} from '../database'
import type { ClubMember, Game, Post, Tournament } from '../types'

async function adminMutation<Result>(operation: string, write: () => Promise<Result>) {
  await requireAdmin()
  return databaseOperation(operation, write)
}

interface GameRow {
  id: unknown
  slug: string
  name: string
  name_en: string | null
  accent_color: string | null
  tagline: string | null
  description: string | null
  format_note: string | null
  sort_order: unknown
  active: boolean
}

const toGame = (row: GameRow): Game => ({
  id: safeDatabaseInteger(row.id, 'game.id'),
  slug: row.slug,
  name: row.name,
  nameEn: row.name_en,
  accentColor: row.accent_color,
  tagline: row.tagline,
  description: row.description,
  formatNote: row.format_note,
  sortOrder: safeDatabaseInteger(row.sort_order, 'game.sort_order'),
  active: row.active,
})

export async function adminListGames(): Promise<Game[]> {
  await requireAdmin()

  return databaseOperation('admin:list-games', async () => {
    const sql = database()
    const rows = await sql<GameRow[]>`
      select id, slug, name, name_en, accent_color, tagline, description,
        format_note, sort_order, active
      from public.game
      order by sort_order asc
    `
    return rows.map(toGame)
  })
}

export function adminSaveGame(id: number, values: Partial<Game>) {
  const payload: Record<string, unknown> = {}
  if (values.name !== undefined) payload.name = values.name
  if (values.nameEn !== undefined) payload.name_en = values.nameEn
  if (values.accentColor !== undefined) payload.accent_color = values.accentColor
  if (values.tagline !== undefined) payload.tagline = values.tagline
  if (values.description !== undefined) payload.description = values.description
  if (values.formatNote !== undefined) payload.format_note = values.formatNote
  if (values.sortOrder !== undefined) payload.sort_order = values.sortOrder
  if (values.active !== undefined) payload.active = values.active

  return adminMutation('admin:save-game', async () => {
    if (Object.keys(payload).length === 0) return
    const sql = database()
    await sql`update public.game set ${sql(payload)} where id = ${id}::bigint`
  })
}

export function adminCreateGame(values: {
  slug: string
  name: string
  nameEn: string | null
  accentColor: string | null
  tagline: string | null
}) {
  return adminMutation('admin:create-game', async () => {
    const sql = database()
    await sql`
      insert into public.game (
        slug, name, name_en, accent_color, tagline, sort_order, active
      ) values (
        ${values.slug}, ${values.name}, ${values.nameEn}, ${values.accentColor},
        ${values.tagline}, 99, true
      )
    `
  })
}

export function adminDeleteGame(id: number) {
  return adminMutation('admin:delete-game', async () => {
    const sql = database()
    await sql`delete from public.game where id = ${id}::bigint`
  })
}

interface PostRow {
  id: unknown
  game_id: unknown | null
  slug: string
  title: string
  summary: string
  body: string
  published_at: unknown
  pinned: boolean
}

const toPost = (row: PostRow): Post => ({
  id: safeDatabaseInteger(row.id, 'post.id'),
  gameId: row.game_id === null ? null : safeDatabaseInteger(row.game_id, 'post.game_id'),
  slug: row.slug,
  title: row.title,
  summary: row.summary,
  body: row.body,
  publishedAt: isoDatabaseTimestamp(row.published_at, 'post.published_at'),
  pinned: row.pinned,
})

export async function adminListPosts(): Promise<Post[]> {
  await requireAdmin()

  return databaseOperation('admin:list-posts', async () => {
    const sql = database()
    const rows = await sql<PostRow[]>`
      select id, game_id, slug, title, summary, body, published_at, pinned
      from public.post
      order by pinned desc, published_at desc
    `
    return rows.map(toPost)
  })
}

export function adminCreatePost(values: {
  slug: string
  title: string
  summary: string
  body: string
  gameId: number | null
  pinned: boolean
}) {
  return adminMutation('admin:create-post', async () => {
    const sql = database()
    await sql`
      insert into public.post (slug, title, summary, body, game_id, pinned)
      values (
        ${values.slug}, ${values.title}, ${values.summary}, ${values.body},
        ${values.gameId}::bigint, ${values.pinned}
      )
    `
  })
}

export function adminSavePost(id: number, values: Partial<Post>) {
  const payload: Record<string, unknown> = {}
  if (values.title !== undefined) payload.title = values.title
  if (values.summary !== undefined) payload.summary = values.summary
  if (values.body !== undefined) payload.body = values.body
  if (values.gameId !== undefined) payload.game_id = values.gameId
  if (values.pinned !== undefined) payload.pinned = values.pinned

  return adminMutation('admin:save-post', async () => {
    if (Object.keys(payload).length === 0) return
    const sql = database()
    await sql`update public.post set ${sql(payload)} where id = ${id}::bigint`
  })
}

export function adminDeletePost(id: number) {
  return adminMutation('admin:delete-post', async () => {
    const sql = database()
    await sql`delete from public.post where id = ${id}::bigint`
  })
}

interface MemberRow {
  id: unknown
  name: string
  role: string
  handle: string | null
  intro: string | null
  sort_order: unknown
}

export async function adminListMembers(): Promise<ClubMember[]> {
  await requireAdmin()

  return databaseOperation('admin:list-members', async () => {
    const sql = database()
    const rows = await sql<MemberRow[]>`
      select id, name, role, handle, intro, sort_order
      from public.club_member
      order by sort_order asc
    `
    return rows.map(row => ({
      id: safeDatabaseInteger(row.id, 'club_member.id'),
      name: row.name,
      role: row.role,
      handle: row.handle,
      intro: row.intro,
      sortOrder: safeDatabaseInteger(row.sort_order, 'club_member.sort_order'),
    }))
  })
}

export function adminSaveMember(id: number, values: Partial<ClubMember>) {
  const payload: Record<string, unknown> = {}
  if (values.name !== undefined) payload.name = values.name
  if (values.handle !== undefined) payload.handle = values.handle
  if (values.intro !== undefined) payload.intro = values.intro

  return adminMutation('admin:save-member', async () => {
    if (Object.keys(payload).length === 0) return
    const sql = database()
    await sql`update public.club_member set ${sql(payload)} where id = ${id}::bigint`
  })
}

interface TournamentRow {
  id: unknown
  slug: string
  title: string
  game_id: unknown | null
  season: string
  edition: unknown
  status: Tournament['status']
  format: string
  team_cap: unknown
  reg_deadline: unknown | null
  starts_at: unknown | null
  accent_color: string | null
  map_pool: Tournament['mapPool'] | null
  rules: Tournament['rules'] | null
  faqs: Tournament['faqs'] | null
  hero_eyebrow: string
  hero_top: string
  hero_bottom: string
  lede: string
  champion_name: string | null
  champion_note: string | null
}

function toTournament(row: TournamentRow): Tournament {
  return {
    id: safeDatabaseInteger(row.id, 'tournament.id'),
    slug: row.slug,
    title: row.title,
    gameId: row.game_id === null ? null : safeDatabaseInteger(row.game_id, 'tournament.game_id'),
    gameSlug: null,
    gameName: null,
    season: row.season,
    edition: safeDatabaseInteger(row.edition, 'tournament.edition'),
    status: row.status,
    format: row.format,
    teamCap: safeDatabaseInteger(row.team_cap, 'tournament.team_cap'),
    regDeadline: nullableIsoDatabaseTimestamp(row.reg_deadline, 'tournament.reg_deadline'),
    startsAt: nullableIsoDatabaseTimestamp(row.starts_at, 'tournament.starts_at'),
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
  }
}

export async function adminListTournaments(): Promise<Tournament[]> {
  await requireAdmin()

  return databaseOperation('admin:list-tournaments', async () => {
    const sql = database()
    const rows = await sql<TournamentRow[]>`
      select
        id, slug, title, game_id, season, edition, status, format, team_cap,
        reg_deadline, starts_at, accent_color, map_pool, rules, faqs,
        hero_eyebrow, hero_top, hero_bottom, lede, champion_name, champion_note
      from public.tournament
      order by season desc, edition desc
    `
    return rows.map(toTournament)
  })
}

export function adminCreateTournament(values: {
  slug: string
  title: string
  gameId: number
  season: string
  edition: number
  teamCap: number
}) {
  return adminMutation('admin:create-tournament', async () => {
    const sql = database()
    await sql`
      insert into public.tournament (
        slug, title, game_id, season, edition, team_cap, status, hero_bottom
      ) values (
        ${values.slug}, ${values.title}, ${values.gameId}::bigint, ${values.season},
        ${values.edition}, ${values.teamCap}, 'draft', ${values.title}
      )
    `
  })
}

export function adminDeleteTournament(id: number) {
  return adminMutation('admin:delete-tournament', async () => {
    const sql = database()
    await sql`delete from public.tournament where id = ${id}::bigint`
  })
}

interface PhotoRow {
  id: unknown
  tournament_id: unknown
  storage_key: string
  width: unknown
  height: unknown
  blur_data_url: string | null
  caption: string | null
  sort_order: unknown
}

const toAdminPhoto = (row: PhotoRow) => ({
  id: safeDatabaseInteger(row.id, 'photo.id'),
  tournamentId: safeDatabaseInteger(row.tournament_id, 'photo.tournament_id'),
  storageKey: row.storage_key,
  width: safeDatabaseInteger(row.width, 'photo.width'),
  height: safeDatabaseInteger(row.height, 'photo.height'),
  caption: row.caption,
  sortOrder: safeDatabaseInteger(row.sort_order, 'photo.sort_order'),
})

export async function adminListPhotos(): Promise<
  { id: number; tournamentId: number; storageKey: string; width: number; height: number; caption: string | null; sortOrder: number }[]
> {
  await requireAdmin()

  return databaseOperation('admin:list-photos', async () => {
    const sql = database()
    const rows = await sql<PhotoRow[]>`
      select id, tournament_id, storage_key, width, height, blur_data_url,
        caption, sort_order
      from public.photo
      order by tournament_id desc, sort_order asc
    `
    return rows.map(toAdminPhoto)
  })
}

export async function adminGetPhoto(id: number) {
  await requireAdmin()

  return databaseOperation('admin:get-photo', async () => {
    const sql = database()
    const rows = await sql<PhotoRow[]>`
      select id, tournament_id, storage_key, width, height, blur_data_url,
        caption, sort_order
      from public.photo
      where id = ${id}::bigint
      limit 1
    `
    return rows[0] ? toAdminPhoto(rows[0]) : null
  })
}

export function adminInsertPhoto(values: {
  tournamentId: number
  storageKey: string
  width: number
  height: number
  caption: string | null
  sortOrder: number
}) {
  return adminMutation('admin:insert-photo', async () => {
    const sql = database()
    await sql`
      insert into public.photo (
        tournament_id, storage_key, width, height, caption, sort_order
      ) values (
        ${values.tournamentId}::bigint, ${values.storageKey}, ${values.width},
        ${values.height}, ${values.caption}, ${values.sortOrder}
      )
    `
  })
}

export function adminDeletePhoto(id: number) {
  return adminMutation('admin:delete-photo', async () => {
    const sql = database()
    await sql`delete from public.photo where id = ${id}::bigint`
  })
}

const TOURNAMENT_PATCH_COLUMNS = new Set([
  'slug',
  'title',
  'game_id',
  'season',
  'edition',
  'status',
  'format',
  'team_cap',
  'reg_deadline',
  'starts_at',
  'accent_color',
  'map_pool',
  'hero_eyebrow',
  'hero_top',
  'hero_bottom',
  'lede',
  'champion_name',
  'champion_note',
])

function approvedPatch(values: Record<string, unknown>, columns: ReadonlySet<string>) {
  const payload: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(values)) {
    if (!columns.has(column)) throw new TypeError(`Unsupported database field: ${column}`)
    payload[column] = value
  }
  return payload
}

export function adminSaveTournament(id: number, values: Record<string, unknown>) {
  const payload = approvedPatch(values, TOURNAMENT_PATCH_COLUMNS)
  let mapPool: string[] | undefined
  if ('map_pool' in payload) {
    if (
      !Array.isArray(payload.map_pool) ||
      !payload.map_pool.every(value => typeof value === 'string')
    ) {
      throw new TypeError('map_pool must be an array of strings')
    }
    mapPool = payload.map_pool
    delete payload.map_pool
  }
  return adminMutation('admin:save-tournament', async () => {
    if (Object.keys(payload).length === 0 && mapPool === undefined) return
    const sql = database()
    const patch = mapPool === undefined
      ? payload
      : { ...payload, map_pool: sql.json(mapPool) }
    await sql`update public.tournament set ${sql(patch)} where id = ${id}::bigint`
  })
}

interface SiteSettingRow {
  id: unknown
  club_name: string
  club_name_en: string | null
  school: string
  logo_url: string | null
  contact_qq: string | null
  contact_wechat: string | null
  footer_copy: string | null
}

export async function adminGetSiteSetting() {
  await requireAdmin()

  return databaseOperation('admin:get-site-setting', async () => {
    const sql = database()
    const rows = await sql<SiteSettingRow[]>`
      select id, club_name, club_name_en, school, logo_url, contact_qq,
        contact_wechat, footer_copy
      from public.site_setting
      limit 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: safeDatabaseInteger(row.id, 'site_setting.id'),
      clubName: row.club_name,
      clubNameEn: row.club_name_en,
      school: row.school,
      logoUrl: row.logo_url,
      contactQq: row.contact_qq,
      contactWechat: row.contact_wechat,
      footerCopy: row.footer_copy,
    }
  })
}

const SITE_SETTING_PATCH_COLUMNS = new Set([
  'club_name',
  'club_name_en',
  'school',
  'logo_url',
  'contact_qq',
  'contact_wechat',
  'footer_copy',
])

export function adminSaveSiteSetting(values: Record<string, unknown>) {
  const payload = approvedPatch(values, SITE_SETTING_PATCH_COLUMNS)
  return adminMutation('admin:save-site-setting', async () => {
    if (Object.keys(payload).length === 0) return
    const sql = database()
    await sql`update public.site_setting set ${sql(payload)} where id = 1`
  })
}
