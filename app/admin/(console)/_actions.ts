'use server'

import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { endAdminSession, requireAdmin } from '@/lib/auth'
import {
  assignTeamSeed,
  listAdminMatches,
  listTeamsWithContact,
  replaceBracket,
  replaceMatchSchedule,
  removeTeam,
  saveAdminMatchReport,
  saveAdminMatchScore,
  setTeamStatus,
  removePhoto,
} from '@/lib/queries/admin'
import { MIME_TO_EXT, imageSize, sniffMime } from '@/lib/image'
import { isIsoInstant } from '@/lib/datetime'
import { bracketSize, orderBySeed, seedPositions } from '@/lib/seeding'
import { putObject, removeObject, uploadsEnabled } from '@/lib/storage'
import { deleteRecordThenObjects } from '@/lib/object-cleanup'
import { createPhotoStorageKey } from '@/lib/photo-storage-key'
import {
  adminCreateGame,
  adminCreateOfficialGuestbookReply,
  adminCreateMember,
  adminCreatePost,
  adminCreateTournament,
  adminDeleteGuestbookMessage,
  adminDeleteGame,
  adminDeleteMember,
  adminDeletePost,
  adminDeleteTournament,
  adminSaveGame,
  adminSaveMember,
  adminSavePost,
  adminSaveTournament,
  adminSetGuestbookMessageStatus,
  adminSetGuestbookMessagePinned,
  adminDeletePhoto,
  adminGetPhoto,
  adminInsertPhoto,
  adminListPhotos,
  adminListTournaments,
  adminSaveSiteSetting,
} from '@/lib/queries/content'
import { RdbError } from '@/lib/rdb'
import type { MatchMapInput, MatchScheduleInput } from '@/lib/queries/admin'
import type { TeamStatus, VetoAction } from '@/lib/types'
import type { GuestbookMessageStatus } from '@/lib/types'

function readRdbPayload(error: RdbError) {
  const raw = error.message.slice(error.message.indexOf(':') + 1).trim()
  try {
    return JSON.parse(raw) as { code?: unknown; message?: unknown }
  } catch {
    return null
  }
}

function writeError(error: unknown, fallback: string) {
  if (!(error instanceof RdbError)) {
    console.error(fallback, error)
    return fallback
  }
  if (error.status >= 500) console.error(fallback, error)

  const payload = readRdbPayload(error)
  return typeof payload?.message === 'string' ? payload.message : fallback
}

function scheduleError(error: unknown) {
  if (!(error instanceof RdbError)) return writeError(error, '发布赛程失败')
  const payload = readRdbPayload(error)
  if (payload?.code === '40001') return '赛程已被其他管理员或新签表更新，请刷新后重试'
  if (payload?.code === '22023') return '赛程时间顺序或场次范围无效，请检查后重试'
  return writeError(error, '发布赛程失败')
}

export async function signOut() {
  await endAdminSession()
  redirect('/')
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
    role: String(form.get('role') ?? '').trim(),
    handle: String(form.get('handle') ?? '').trim() || null,
    intro: String(form.get('intro') ?? '').trim() || null,
    sortOrder: Number(form.get('sortOrder')) || 0,
  })
  updateTag('club_member')
}

export async function createMember(form: FormData) {
  await requireAdmin()
  await adminCreateMember({
    name: String(form.get('name') ?? '').trim(),
    role: String(form.get('role') ?? '').trim(),
    handle: String(form.get('handle') ?? '').trim() || null,
    intro: String(form.get('intro') ?? '').trim() || null,
    sortOrder: Number(form.get('sortOrder')) || 0,
  })
  updateTag('club_member')
  redirect('/admin/members')
}

export async function removeMember(id: number) {
  await requireAdmin()
  await adminDeleteMember(id)
  updateTag('club_member')
}

export async function setGuestbookMessageStatus(id: number, status: GuestbookMessageStatus) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '留言编号无效' }
  if (!['pending', 'published', 'hidden'].includes(status)) {
    return { ok: false as const, error: '留言状态无效' }
  }
  await adminSetGuestbookMessageStatus(id, status)
  updateTag('guestbook')
  return { ok: true as const }
}

export async function setGuestbookMessagePinned(id: number, pinned: boolean) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '留言编号无效' }
  try {
    await adminSetGuestbookMessagePinned(id, pinned)
  } catch (error) {
    console.error('[guestbook] pin update failed', error)
    return { ok: false as const, error: '只有主留言可以置顶' }
  }
  updateTag('guestbook')
  return { ok: true as const }
}

export async function createOfficialGuestbookReply(parentId: number, body: string) {
  await requireAdmin()
  const content = body.trim()
  if (!Number.isSafeInteger(parentId) || parentId <= 0) {
    return { ok: false as const, error: '留言编号无效' }
  }
  if (!content || content.length > 500) {
    return { ok: false as const, error: '官方回复需要填写内容，且不能超过 500 个字符' }
  }
  try {
    await adminCreateOfficialGuestbookReply(parentId, content)
  } catch (error) {
    console.error('[guestbook] official reply failed', error)
    return { ok: false as const, error: '官方回复发布失败，请确认原留言仍为公开状态' }
  }
  updateTag('guestbook')
  return { ok: true as const }
}

export async function removeGuestbookMessage(id: number) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '留言编号无效' }
  await adminDeleteGuestbookMessage(id)
  updateTag('guestbook')
  return { ok: true as const }
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
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false as const, error: '赛事编号无效。' }
  }

  const tournaments = await adminListTournaments()
  const tournament = tournaments.find(entry => entry.id === id)
  if (!tournament) return { ok: false as const, error: '赛事不存在或已删除。' }

  const photos = (await adminListPhotos()).filter(photo => photo.tournamentId === id)
  let cleanupFailures
  try {
    cleanupFailures = await deleteRecordThenObjects(
      photos.map(photo => photo.storageKey),
      () => adminDeleteTournament(id),
      removeObject,
    )
  } catch (error) {
    console.error('tournament delete failed before object cleanup', error)
    return { ok: false as const, error: '赛事删除失败，存储对象未改动。' }
  }

  updateTag('tournament')
  updateTag('photo')
  updateTag(`teams:${id}`)
  updateTag(`matches:${id}`)
  if (cleanupFailures.length > 0) {
    console.error(
      'tournament deleted with orphaned photo objects',
      cleanupFailures,
    )
    return {
      ok: true as const,
      warning: `赛事已删除；${cleanupFailures.length} 个私有存储对象需要维护者清理。`,
    }
  }
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
  let key: string | null = null

  try {
    key = createPhotoStorageKey(tournament.slug, MIME_TO_EXT[mime] ?? 'bin')
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
    if (key) {
      await removeObject(key)
        .catch(cleanupError => console.error('photo upload cleanup failed', cleanupError))
    }
    return { ok: false as const, error: '图片保存失败，请稍后重试' }
  }

  updateTag('photo')
  return { ok: true as const, key, width: size.width, height: size.height }
}

export async function deletePhotoAndFile(id: number) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false as const, error: '照片编号无效' }
  }

  const photo = await adminGetPhoto(id)
  if (!photo) return { ok: false as const, error: '照片不存在或已被删除' }

  // The database row is authoritative: remove it first so the guarded media
  // route denies access even if external object cleanup must be retried.
  try {
    await adminDeletePhoto(id)
  } catch (error) {
    console.error('photo record delete failed', error)
    return { ok: false as const, error: '照片记录删除失败，存储对象未改动' }
  }

  try {
    await removeObject(photo.storageKey)
  } catch (error) {
    console.error(`orphaned photo object requires cleanup: ${photo.storageKey}`, error)
    updateTag('photo')
    return { ok: false as const, error: '照片已停止公开，但存储对象清理失败，请联系维护者' }
  }

  updateTag('photo')
  return { ok: true as const }
}

export async function publishMatchSchedule(tournamentId: number, payloadJson: string) {
  await requireAdmin()

  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) {
    return { ok: false as const, error: '赛事编号无效' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(payloadJson)
  } catch {
    return { ok: false as const, error: '赛程数据格式无效' }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false as const, error: '赛程场次数量无效' }
  }

  const normaliseTimestamp = (value: unknown): string | null | undefined => {
    if (value === null) return null
    return isIsoInstant(value) ? value : undefined
  }

  const schedule: MatchScheduleInput[] = []
  const ids = new Set<number>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false as const, error: '赛程场次格式无效' }
    }
    const row = entry as Record<string, unknown>
    const id = Number(row.id)
    const expectedScheduledAt = normaliseTimestamp(row.expectedScheduledAt)
    const scheduledAt = normaliseTimestamp(row.scheduledAt)
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      ids.has(id) ||
      expectedScheduledAt === undefined ||
      scheduledAt === undefined
    ) {
      return { ok: false as const, error: '赛程场次或时间无效' }
    }
    ids.add(id)
    schedule.push({ id, expectedScheduledAt, scheduledAt })
  }

  let result: Awaited<ReturnType<typeof replaceMatchSchedule>>
  try {
    result = await replaceMatchSchedule(tournamentId, schedule)
  } catch (error) {
    return { ok: false as const, error: scheduleError(error) }
  }

  updateTag(`matches:${tournamentId}`)
  return result
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
