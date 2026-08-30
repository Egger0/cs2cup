import 'server-only'
import { requireAdmin } from '../auth'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRow,
  selectPrivateRows,
  updatePrivateRows,
} from '../rdb'
import type { ClubMember, Game, Post, Tournament } from '../types'

async function adminMutation<Result>(write: () => Promise<Result>) {
  await requireAdmin()
  return write()
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

export async function adminListGames(): Promise<Game[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<GameRow>('game', { order: 'sort_order.asc' })
  return rows.map(toGame)
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
  return adminMutation(() =>
    updatePrivateRows('game', payload, { filters: { id: `eq.${id}` } }),
  )
}

export function adminCreateGame(values: {
  slug: string
  name: string
  nameEn: string | null
  accentColor: string | null
  tagline: string | null
}) {
  return adminMutation(() =>
    insertPrivateRows(
      'game',
      {
        slug: values.slug,
        name: values.name,
        name_en: values.nameEn,
        accent_color: values.accentColor,
        tagline: values.tagline,
        sort_order: 99,
        active: true,
      },
    ),
  )
}

export function adminDeleteGame(id: number) {
  return adminMutation(() =>
    deletePrivateRows('game', { filters: { id: `eq.${id}` } }),
  )
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

const toPost = (row: PostRow): Post => ({
  id: row.id,
  gameId: row.game_id,
  slug: row.slug,
  title: row.title,
  summary: row.summary,
  body: row.body,
  publishedAt: row.published_at,
  pinned: row.pinned,
})

export async function adminListPosts(): Promise<Post[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<PostRow>('post', {
    order: 'pinned.desc,published_at.desc',
  })
  return rows.map(toPost)
}

export function adminCreatePost(values: {
  slug: string
  title: string
  summary: string
  body: string
  gameId: number | null
  pinned: boolean
}) {
  return adminMutation(() =>
    insertPrivateRows(
      'post',
      {
        slug: values.slug,
        title: values.title,
        summary: values.summary,
        body: values.body,
        game_id: values.gameId,
        pinned: values.pinned,
      },
    ),
  )
}

export function adminSavePost(id: number, values: Partial<Post>) {
  const payload: Record<string, unknown> = {}
  if (values.title !== undefined) payload.title = values.title
  if (values.summary !== undefined) payload.summary = values.summary
  if (values.body !== undefined) payload.body = values.body
  if (values.gameId !== undefined) payload.game_id = values.gameId
  if (values.pinned !== undefined) payload.pinned = values.pinned
  return adminMutation(() =>
    updatePrivateRows('post', payload, { filters: { id: `eq.${id}` } }),
  )
}

export function adminDeletePost(id: number) {
  return adminMutation(() =>
    deletePrivateRows('post', { filters: { id: `eq.${id}` } }),
  )
}

interface MemberRow {
  id: number
  name: string
  role: string
  handle: string | null
  intro: string | null
  sort_order: number
}

export async function adminListMembers(): Promise<ClubMember[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<MemberRow>('club_member', { order: 'sort_order.asc' })
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    role: row.role,
    handle: row.handle,
    intro: row.intro,
    sortOrder: row.sort_order,
  }))
}

export function adminCreateMember(values: Omit<ClubMember, 'id'>) {
  return adminMutation(() =>
    insertPrivateRows('club_member', {
      name: values.name,
      role: values.role,
      handle: values.handle,
      intro: values.intro,
      sort_order: values.sortOrder,
    }),
  )
}

export function adminSaveMember(id: number, values: Partial<ClubMember>) {
  const payload: Record<string, unknown> = {}
  if (values.name !== undefined) payload.name = values.name
  if (values.role !== undefined) payload.role = values.role
  if (values.handle !== undefined) payload.handle = values.handle
  if (values.intro !== undefined) payload.intro = values.intro
  if (values.sortOrder !== undefined) payload.sort_order = values.sortOrder
  return adminMutation(() =>
    updatePrivateRows('club_member', payload, { filters: { id: `eq.${id}` } }),
  )
}

export function adminDeleteMember(id: number) {
  return adminMutation(() =>
    deletePrivateRows('club_member', { filters: { id: `eq.${id}` } }),
  )
}

interface TournamentRow {
  id: number
  slug: string
  title: string
  game_id: number | null
  season: string
  edition: number
  status: string
  format: string
  team_cap: number
  reg_deadline: string | null
  starts_at: string | null
  accent_color: string | null
  map_pool: Tournament['mapPool']
  rules: Tournament['rules']
  faqs: Tournament['faqs']
  hero_eyebrow: string
  hero_top: string
  hero_bottom: string
  lede: string
  champion_name: string | null
  champion_note: string | null
}

export async function adminListTournaments(): Promise<Tournament[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<TournamentRow>('tournament', {
    order: 'season.desc,edition.desc',
  })
  return rows.map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    gameId: row.game_id,
    gameSlug: null,
    gameName: null,
    season: row.season,
    edition: row.edition,
    status: row.status as Tournament['status'],
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
  }))
}

export function adminCreateTournament(values: {
  slug: string
  title: string
  gameId: number
  season: string
  edition: number
  teamCap: number
}) {
  return adminMutation(() =>
    insertPrivateRows(
      'tournament',
      {
        slug: values.slug,
        title: values.title,
        game_id: values.gameId,
        season: values.season,
        edition: values.edition,
        team_cap: values.teamCap,
        status: 'draft',
        hero_bottom: values.title,
      },
    ),
  )
}

export function adminDeleteTournament(id: number) {
  return adminMutation(() =>
    deletePrivateRows('tournament', { filters: { id: `eq.${id}` } }),
  )
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

const toAdminPhoto = (row: PhotoRow) => ({
  id: row.id,
  tournamentId: row.tournament_id,
  storageKey: row.storage_key,
  width: row.width,
  height: row.height,
  caption: row.caption,
  sortOrder: row.sort_order,
})

export async function adminListPhotos(): Promise<
  { id: number; tournamentId: number; storageKey: string; width: number; height: number; caption: string | null; sortOrder: number }[]
> {
  await requireAdmin()

  const rows = await selectPrivateRows<PhotoRow>('photo', {
    order: 'tournament_id.desc,sort_order.asc',
  })
  return rows.map(toAdminPhoto)
}

export async function adminGetPhoto(id: number) {
  await requireAdmin()

  const row = await selectPrivateRow<PhotoRow>('photo', {
    filters: { id: `eq.${id}` },
  })
  return row ? toAdminPhoto(row) : null
}

export function adminInsertPhoto(values: {
  tournamentId: number
  storageKey: string
  width: number
  height: number
  caption: string | null
  sortOrder: number
}) {
  return adminMutation(() =>
    insertPrivateRows(
      'photo',
      {
        tournament_id: values.tournamentId,
        storage_key: values.storageKey,
        width: values.width,
        height: values.height,
        caption: values.caption,
        sort_order: values.sortOrder,
      },
    ),
  )
}

export function adminDeletePhoto(id: number) {
  return adminMutation(() =>
    deletePrivateRows('photo', { filters: { id: `eq.${id}` } }),
  )
}

export function adminSaveTournament(id: number, values: Record<string, unknown>) {
  return adminMutation(() =>
    updatePrivateRows('tournament', values, { filters: { id: `eq.${id}` } }),
  )
}

export async function adminGetSiteSetting() {
  await requireAdmin()

  const rows = await selectPrivateRows<{
    id: number
    club_name: string
    club_name_en: string | null
    school: string
    logo_url: string | null
    contact_qq: string | null
    contact_wechat: string | null
    footer_copy: string | null
  }>('site_setting', { limit: 1 })
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    clubName: row.club_name,
    clubNameEn: row.club_name_en,
    school: row.school,
    logoUrl: row.logo_url,
    contactQq: row.contact_qq,
    contactWechat: row.contact_wechat,
    footerCopy: row.footer_copy,
  }
}

export function adminSaveSiteSetting(values: Record<string, unknown>) {
  return adminMutation(() =>
    updatePrivateRows('site_setting', values, { filters: { id: 'eq.1' } }),
  )
}
