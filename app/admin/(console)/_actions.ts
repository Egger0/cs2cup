'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { SESSION_COOKIE, requireAdmin, verifyToken } from '@/lib/auth'
import {
  assignTeamSeed,
  listAdminMatches,
  listTeamsWithContact,
  replaceBracket,
  removeTeam,
  saveAdminMatchReport,
  saveAdminMatchScore,
  setTeamStatus,
  removePhoto,
} from '@/lib/queries/admin'
import { MIME_TO_EXT, imageSize, sniffMime } from '@/lib/image'
import { isByeMatch } from '@/lib/bracket'
import { bracketSize, orderBySeed, seedPositions } from '@/lib/seeding'
import { putObject, removeObject, uploadsEnabled } from '@/lib/storage'
import {
  adminCreateGame,
  adminCreatePost,
  adminCreateTournament,
  adminDeleteGame,
  adminDeletePost,
  adminDeleteTournament,
  adminSaveGame,
  adminSaveMember,
  adminSavePost,
  adminSaveTournament,
  adminScheduleMatch,
  adminDeletePhoto,
  adminInsertPhoto,
  adminListPhotos,
  adminListTournaments,
  adminSaveSiteSetting,
} from '@/lib/queries/content'
import { RdbError, selectRows } from '@/lib/rdb'
import type { MatchMapInput } from '@/lib/queries/admin'
import type { TeamStatus, VetoAction } from '@/lib/types'

const SESSION_MAX_AGE = 60 * 60 * 8

function writeError(error: unknown, fallback: string) {
  if (!(error instanceof RdbError)) {
    console.error(fallback, error)
    return fallback
  }
  if (error.status >= 500) console.error(fallback, error)

  const raw = error.message.slice(error.message.indexOf(':') + 1).trim()
  try {
    const payload = JSON.parse(raw) as { message?: unknown }
    return typeof payload.message === 'string' ? payload.message : fallback
  } catch {
    return fallback
  }
}

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

  if (seed !== null && !Number.isInteger(seed)) {
    return { ok: false as const, error: '种子号必须是整数' }
  }

  try {
    await assignTeamSeed(tournamentId, id, seed)
  } catch (error) {
    return { ok: false as const, error: writeError(error, '种子号保存失败') }
  }

  updateTag(`teams:${tournamentId}`)
  return { ok: true as const }
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

export async function buildBracket(tournamentId: number) {
  await requireAdmin()

  const teams = await listTeamsWithContact(tournamentId)
  const approved = teams
    .filter(team => team.status === 'approved')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  if (approved.length < 2) return { ok: false as const, error: '通过审核的战队不足两支' }

  const size = bracketSize(approved.length)
  let orderedTeams: typeof approved
  try {
    orderedTeams = orderBySeed(approved)
  } catch {
    return { ok: false as const, error: `种子号必须唯一且位于 1–${approved.length}` }
  }

  let result: Awaited<ReturnType<typeof replaceBracket>>
  try {
    result = await replaceBracket(
      tournamentId,
      orderedTeams.map(team => team.id),
      seedPositions(size),
    )
  } catch (error) {
    return { ok: false as const, error: writeError(error, '生成对阵表失败') }
  }

  updateTag(`matches:${tournamentId}`)
  updateTag('match_map')
  updateTag('tournament')
  return result
}

export async function recordScore(
  matchId: number,
  teamAId: number,
  teamBId: number,
  scoreA: number | null,
  scoreB: number | null,
  tournamentId: number,
) {
  await requireAdmin()

  const matches = await listAdminMatches(tournamentId)
  if (!matches.some(match => match.id === matchId)) {
    return { ok: false as const, error: '比赛不存在' }
  }

  let result: Awaited<ReturnType<typeof saveAdminMatchScore>>
  try {
    result = await saveAdminMatchScore(matchId, teamAId, teamBId, scoreA, scoreB)
  } catch (error) {
    return { ok: false as const, error: writeError(error, '比分保存失败') }
  }

  updateTag(`matches:${tournamentId}`)
  updateTag('match_map')
  updateTag('tournament')
  return result
}

export async function saveMatchReport(
  matchId: number,
  tournamentId: number,
  teamAId: number,
  teamBId: number,
  mapsJson: string,
) {
  await requireAdmin()

  const matches = await listAdminMatches(tournamentId)
  if (!matches.some(match => match.id === matchId)) {
    return { ok: false as const, error: '比赛不存在' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(mapsJson)
  } catch {
    return { ok: false as const, error: '战报数据格式无效' }
  }
  if (!Array.isArray(raw) || raw.length > 32) {
    return { ok: false as const, error: '战报步骤数量无效' }
  }

  const readScore = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null
    const score = Number(value)
    return Number.isInteger(score) ? score : Number.NaN
  }

  const maps: MatchMapInput[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false as const, error: '战报步骤格式无效' }
    }
    const row = entry as Record<string, unknown>
    const mapName = String(row.mapName ?? '').trim()
    const action = String(row.action ?? '') as VetoAction
    const scoreA = readScore(row.scoreA)
    const scoreB = readScore(row.scoreB)
    if (!mapName || !['ban', 'pick', 'decider'].includes(action)) {
      return { ok: false as const, error: '请补全地图和操作类型' }
    }
    if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) {
      return { ok: false as const, error: '地图比分必须是整数' }
    }
    maps.push({
      mapName,
      action,
      chosenBy: row.chosenBy === 'a' || row.chosenBy === 'b' ? row.chosenBy : null,
      scoreA,
      scoreB,
      played: row.played === true,
    })
  }

  let result: Awaited<ReturnType<typeof saveAdminMatchReport>>
  try {
    result = await saveAdminMatchReport(matchId, teamAId, teamBId, maps)
  } catch (error) {
    return { ok: false as const, error: writeError(error, '战报保存失败') }
  }
  if (result.ok) {
    updateTag(`matches:${tournamentId}`)
    updateTag('match_map')
    updateTag('tournament')
  }
  return result
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

export async function removeGame(id: number) {
  await requireAdmin()

  const tournaments = await adminListTournaments()
  const linked = tournaments.filter(tournament => tournament.gameId === id)
  if (linked.length > 0) {
    return { ok: false as const, error: `该项目关联了 ${linked.length} 个赛事，请先处理这些赛事。` }
  }

  await adminDeleteGame(id)
  updateTag('game')
  updateTag('post')
  return { ok: true as const }
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

export async function removeTournament(id: number) {
  await requireAdmin()

  const tournaments = await adminListTournaments()
  const tournament = tournaments.find(entry => entry.id === id)
  if (!tournament) return { ok: false as const, error: '赛事不存在或已删除。' }

  const photos = (await adminListPhotos()).filter(photo => photo.tournamentId === id)
  for (const photo of photos) {
    try {
      await removeObject(photo.storageKey)
    } catch (error) {
      console.error('tournament photo delete failed', error)
      return { ok: false as const, error: '云存储图片删除失败，赛事未删除。' }
    }
  }

  await adminDeleteTournament(id)
  updateTag('tournament')
  updateTag('photo')
  updateTag(`teams:${id}`)
  updateTag(`matches:${id}`)
  return { ok: true as const }
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
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false as const, error: '单张图片不要超过 10 MB' }
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

  try {
    await putObject(key, buffer, mime)
    await adminInsertPhoto({
      tournamentId,
      storageKey: key,
      width: size.width,
      height: size.height,
      caption: String(form.get('caption') ?? '').trim() || null,
      sortOrder: mine.length,
    })
  } catch (error) {
    console.error('photo upload failed', error)
    await removeObject(key).catch(cleanupError => console.error('photo upload cleanup failed', cleanupError))
    return { ok: false as const, error: '图片保存失败，请稍后重试' }
  }

  updateTag('photo')
  return { ok: true as const, key, width: size.width, height: size.height }
}

export async function deletePhotoAndFile(id: number, storageKey: string) {
  await requireAdmin()
  try {
    await removeObject(storageKey)
  } catch (error) {
    console.error('photo delete failed', error)
    return { ok: false as const, error: '云存储删除失败，未移除照片记录' }
  }

  try {
    await adminDeletePhoto(id)
  } catch (error) {
    console.error('photo record delete failed', error)
    return { ok: false as const, error: '图片已从云存储删除，但照片记录未移除' }
  }

  updateTag('photo')
  return { ok: true as const }
}

export async function scheduleRounds(
  tournamentId: number,
  startIso: string,
  roundGapDays: number,
  matchGapMinutes: number,
) {
  await requireAdmin()

  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return { ok: false as const, error: '开赛时间无效' }
  if (!Number.isInteger(roundGapDays) || roundGapDays < 0) {
    return { ok: false as const, error: '每轮间隔必须是非负整数' }
  }
  if (!Number.isInteger(matchGapMinutes) || matchGapMinutes < 0) {
    return { ok: false as const, error: '场次间隔必须是非负整数' }
  }

  const matches = (await listAdminMatches(tournamentId)).filter(match => !isByeMatch(match))
  if (matches.length === 0) return { ok: false as const, error: '没有需要排程的比赛' }

  const roundSlots = new Map<number, number>()
  for (const match of matches) {
    const roundSlot = roundSlots.get(match.round) ?? 0
    const when = new Date(start)
    when.setDate(when.getDate() + match.round * roundGapDays)
    when.setMinutes(when.getMinutes() + roundSlot * matchGapMinutes)
    await adminScheduleMatch(match.id, when.toISOString())
    roundSlots.set(match.round, roundSlot + 1)
  }

  updateTag(`matches:${tournamentId}`)
  return { ok: true as const, scheduled: matches.length }
}

export async function setMatchTime(id: number, tournamentId: number, value: string) {
  await requireAdmin()
  const iso = value ? new Date(value).toISOString() : null
  await adminScheduleMatch(id, iso)
  updateTag(`matches:${tournamentId}`)
}

export async function updateSiteSetting(form: FormData) {
  await requireAdmin()
  await adminSaveSiteSetting({
    club_name: String(form.get('clubName') ?? '').trim(),
    club_name_en: String(form.get('clubNameEn') ?? '').trim() || null,
    school: String(form.get('school') ?? '').trim(),
    contact_qq: String(form.get('contactQq') ?? '').trim() || null,
    contact_wechat: String(form.get('contactWechat') ?? '').trim() || null,
    footer_copy: String(form.get('footerCopy') ?? '').trim() || null,
  })
  updateTag('site_setting')
}
