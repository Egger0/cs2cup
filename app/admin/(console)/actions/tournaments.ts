'use server'

import { updateTag } from 'next/cache'
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
import { parseTournamentCreate, parseTournamentUpdate } from '@/lib/tournament-form'
import { writeError } from './_errors'

export type TournamentCreateResult =
  | { ok: true }
  | {
      ok: false
      error: string
    }

export async function updateTournament(id: number, form: FormData) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false as const, error: '赛事编号无效' }
  }

  const parsed = parseTournamentUpdate(form)
  if (!parsed.ok) return parsed

  try {
    const saved = await adminSaveTournament(id, parsed.value)
    if (!saved) return { ok: false as const, error: '赛事不存在或已删除' }
  } catch (error) {
    return { ok: false as const, error: writeError(error, '赛事保存失败') }
  }
  updateTag('tournament')
  return { ok: true as const }
}

export async function createTournament(form: FormData): Promise<TournamentCreateResult> {
  await requireAdmin()
  const parsed = parseTournamentCreate(form)
  if (!parsed.ok) return parsed

  try {
    await adminCreateTournament(parsed.value)
  } catch (error) {
    return { ok: false, error: writeError(error, '赛事创建失败') }
  }
  updateTag('tournament')
  return { ok: true }
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
