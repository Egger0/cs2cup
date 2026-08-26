'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { SESSION_COOKIE, requireAdmin, verifyToken } from '@/lib/auth'
import {
  clearMatches,
  listAdminMatches,
  listTeamsWithContact,
  removeTeam,
  saveMatchScore,
  setTeamSeed,
  setTeamStatus,
  removePhoto,
} from '@/lib/queries/admin'
import { decideWinner, downstreamOf } from '@/lib/bracket'
import { MIME_TO_EXT, imageSize, sniffMime } from '@/lib/image'
import { firstRoundPairs, planRounds } from '@/lib/seeding'
import { putObject, removeObject, uploadsEnabled } from '@/lib/storage'
import {
  adminCreateGame,
  adminCreatePost,
  adminCreateTournament,
  adminDeletePost,
  adminSaveGame,
  adminSaveMember,
  adminSavePost,
  adminDeleteMatches,
  adminInsertMatches,
  adminLinkMatch,
  adminSaveTournament,
  adminSeedTeam,
  adminDeletePhoto,
  adminInsertPhoto,
  adminListPhotos,
  adminListTournaments,
} from '@/lib/queries/content'
import { selectRows } from '@/lib/rdb'
import type { Match, TeamStatus } from '@/lib/types'

const SESSION_MAX_AGE = 60 * 60 * 8

async function passwordToken(username: string, password: string) {
  const env = process.env.CLOUDBASE_ENV_ID
  if (!env) return null

  try {
    const response = await fetch(`https://${env}.api.tcloudbasegateway.com/auth/v1/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    })
    if (!response.ok) return null

    const payload = (await response.json()) as { access_token?: unknown }
    return typeof payload.access_token === 'string' ? payload.access_token : null
  } catch {
    return null
  }
}

export async function signIn(username: string, password: string) {
  const token = await passwordToken(username, password)
  if (!token) return { ok: false as const, error: '登录凭证无效' }

  const claims = await verifyToken(token)
  if (!claims) return { ok: false as const, error: '登录凭证无效' }

  const rows = await selectRows<{ user_id: string }>('admin_user', {
    select: 'user_id',
    credential: 'admin',
    revalidate: false,
  })
  if (!rows.some(row => row.user_id === claims.sub)) {
    return { ok: false as const, error: '该账号不在管理员白名单中' }
  }

  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })

  return { ok: true as const }
}

export async function signOut() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  redirect('/admin/login')
}

export async function updateTeamStatus(id: number, status: TeamStatus, tournamentId: number) {
  await requireAdmin()
  await setTeamStatus(id, status)
  updateTag(`teams:${tournamentId}`)
}

export async function updateTeamSeed(id: number, seed: number | null, tournamentId: number) {
  await requireAdmin()
  await setTeamSeed(id, seed)
  updateTag(`teams:${tournamentId}`)
}

export async function deleteTeam(id: number, tournamentId: number) {
  await requireAdmin()
  await removeTeam(id)
  updateTag(`teams:${tournamentId}`)
}

export async function updateTournament(id: number, form: FormData) {
  await requireAdmin()
  const mapPool = String(form.get('mapPool') ?? '')
    .split(/[,，]/)
    .map(entry => entry.trim())
    .filter(Boolean)

  await adminSaveTournament(id, {
    title: String(form.get('title') ?? '').trim(),
    hero_bottom: String(form.get('heroBottom') ?? '').trim(),
    hero_eyebrow: String(form.get('heroEyebrow') ?? '').trim(),
    lede: String(form.get('lede') ?? '').trim(),
    status: String(form.get('status') ?? 'draft'),
    team_cap: Number(form.get('teamCap')),
    game_id: Number(form.get('gameId')),
    map_pool: mapPool,
    champion_name: String(form.get('championName') ?? '').trim() || null,
    champion_note: String(form.get('championNote') ?? '').trim() || null,
  })
  updateTag('tournament')
}

export async function buildBracket(tournamentId: number, teamCap: number) {
  await requireAdmin()

  const teams = await listTeamsWithContact(tournamentId)
  const approved = teams
    .filter(team => team.status === 'approved')
    .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.createdAt.localeCompare(b.createdAt))

  if (approved.length < 2) return { ok: false as const, error: '通过审核的战队不足两支' }

  for (const [index, team] of approved.entries()) {
    if (team.seed !== index + 1) await adminSeedTeam(team.id, index + 1)
  }

  await adminDeleteMatches(tournamentId)

  const rounds = planRounds(teamCap)
  const rows = rounds.flatMap(round =>
    Array.from({ length: round.matches }, (_, slot) => ({
      tournamentId,
      round: round.round,
      slot,
      roundLabel: round.label,
      bestOf: round.bestOf,
    })),
  )
  await adminInsertMatches(rows)

  const created = await listAdminMatches(tournamentId)
  const find = (round: number, slot: number) =>
    created.find(match => match.round === round && match.slot === slot)

  for (const match of created) {
    if (match.round === 0) continue
    const a = find(match.round - 1, match.slot * 2)
    const b = find(match.round - 1, match.slot * 2 + 1)
    if (a && b) await adminLinkMatch(match.id, { sourceA: a.id, sourceB: b.id })
  }

  const size = 2 ** Math.ceil(Math.log2(Math.max(2, teamCap)))
  const bySeed = new Map(approved.map(team => [team.seed ?? 0, team.id]))
  for (const [slot, [high, low]] of firstRoundPairs(size).entries()) {
    const match = find(0, slot)
    if (!match) continue
    await adminLinkMatch(match.id, {
      teamA: bySeed.get(high) ?? null,
      teamB: bySeed.get(low) ?? null,
    })
  }

  updateTag(`matches:${tournamentId}`)
  updateTag('tournament')
  return { ok: true as const, created: rows.length }
}

export async function recordScore(
  matchId: number,
  scoreA: number | null,
  scoreB: number | null,
  tournamentId: number,
) {
  await requireAdmin()

  const matches = await listAdminMatches(tournamentId)
  const target = matches.find(match => match.id === matchId)
  if (!target) return { ok: false as const, error: '比赛不存在' }

  const updated: Match = { ...target, scoreA, scoreB }
  const winner = decideWinner(updated)

  await saveMatchScore(matchId, scoreA, scoreB, winner)
  await clearMatches(downstreamOf(matchId, matches))

  updateTag(`matches:${tournamentId}`)
  return { ok: true as const }
}

export async function deletePhoto(id: number) {
  await requireAdmin()
  await removePhoto(id)
  updateTag('photo')
}

export async function createPost(form: FormData) {
  await requireAdmin()
  const gameId = String(form.get('gameId') ?? '')
  await adminCreatePost({
    slug: String(form.get('slug') ?? '').trim(),
    title: String(form.get('title') ?? '').trim(),
    summary: String(form.get('summary') ?? '').trim(),
    body: String(form.get('body') ?? '').trim(),
    gameId: gameId ? Number(gameId) : null,
    pinned: form.get('pinned') === 'on',
  })
  updateTag('post')
  redirect('/admin/posts')
}

export async function updatePost(id: number, form: FormData) {
  await requireAdmin()
  const gameId = String(form.get('gameId') ?? '')
  await adminSavePost(id, {
    title: String(form.get('title') ?? '').trim(),
    summary: String(form.get('summary') ?? '').trim(),
    body: String(form.get('body') ?? '').trim(),
    gameId: gameId ? Number(gameId) : null,
    pinned: form.get('pinned') === 'on',
  })
  updateTag('post')
}

export async function removePost(id: number) {
  await requireAdmin()
  await adminDeletePost(id)
  updateTag('post')
}

export async function updateGame(id: number, form: FormData) {
  await requireAdmin()
  await adminSaveGame(id, {
    name: String(form.get('name') ?? '').trim(),
    nameEn: String(form.get('nameEn') ?? '').trim() || null,
    accentColor: String(form.get('accentColor') ?? '').trim() || null,
    tagline: String(form.get('tagline') ?? '').trim() || null,
    description: String(form.get('description') ?? '').trim() || null,
    formatNote: String(form.get('formatNote') ?? '').trim() || null,
    active: form.get('active') === 'on',
  })
  updateTag('game')
}

export async function createGame(form: FormData) {
  await requireAdmin()
  await adminCreateGame({
    slug: String(form.get('slug') ?? '').trim(),
    name: String(form.get('name') ?? '').trim(),
    nameEn: String(form.get('nameEn') ?? '').trim() || null,
    accentColor: String(form.get('accentColor') ?? '').trim() || null,
    tagline: String(form.get('tagline') ?? '').trim() || null,
  })
  updateTag('game')
  redirect('/admin/games')
}

export async function updateMember(id: number, form: FormData) {
  await requireAdmin()
  await adminSaveMember(id, {
    name: String(form.get('name') ?? '').trim(),
    handle: String(form.get('handle') ?? '').trim() || null,
    intro: String(form.get('intro') ?? '').trim() || null,
  })
  updateTag('club_member')
}

export async function createTournament(form: FormData) {
  await requireAdmin()
  await adminCreateTournament({
    slug: String(form.get('slug') ?? '').trim(),
    title: String(form.get('title') ?? '').trim(),
    gameId: Number(form.get('gameId')),
    season: String(form.get('season') ?? '').trim(),
    edition: Number(form.get('edition')),
    teamCap: Number(form.get('teamCap')),
  })
  updateTag('tournament')
  redirect('/admin/tournaments')
}

export async function uploadPhoto(form: FormData) {
  await requireAdmin()

  if (!uploadsEnabled()) {
    return { ok: false as const, error: '没有配置上传存储' }
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false as const, error: '请选择一张图片' }
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false as const, error: '单张图片不要超过 8MB' }
  }

  const tournamentId = Number(form.get('tournamentId'))
  if (!Number.isInteger(tournamentId)) {
    return { ok: false as const, error: '请选择赛事' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buffer)
  if (!mime) return { ok: false as const, error: '只支持 JPEG、PNG 或 WebP' }

  const size = imageSize(mime, buffer)
  if (!size) return { ok: false as const, error: '无法读取图片尺寸' }

  const tournaments = await adminListTournaments()
  const tournament = tournaments.find(entry => entry.id === tournamentId)
  if (!tournament) return { ok: false as const, error: '赛事不存在' }

  const existing = await adminListPhotos()
  const mine = existing.filter(photo => photo.tournamentId === tournamentId)
  const key = `${tournament.slug}/${Date.now()}.${MIME_TO_EXT[mime] ?? 'bin'}`

  await putObject(key, buffer, mime)
  await adminInsertPhoto({
    tournamentId,
    storageKey: key,
    width: size.width,
    height: size.height,
    caption: String(form.get('caption') ?? '').trim() || null,
    sortOrder: mine.length,
  })

  updateTag('photo')
  return { ok: true as const, key, width: size.width, height: size.height }
}

export async function deletePhotoAndFile(id: number, storageKey: string) {
  await requireAdmin()
  await adminDeletePhoto(id)
  await removeObject(storageKey)
  updateTag('photo')
}
