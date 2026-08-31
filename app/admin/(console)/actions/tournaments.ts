'use server'

import { updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { deleteRecordThenObjects } from '@/lib/object-cleanup'
import {
  adminCreateTournament,
  adminDeleteTournament,
  adminListPhotos,
  adminListTournaments,
  adminSaveTournament,
} from '@/lib/queries/content'
import { removeObject } from '@/lib/storage'

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
    console.error('tournament deleted with orphaned photo objects', cleanupFailures)
    return {
      ok: true as const,
      warning: `赛事已删除；${cleanupFailures.length} 个私有存储对象需要维护者清理。`,
    }
  }
  return { ok: true as const }
}
