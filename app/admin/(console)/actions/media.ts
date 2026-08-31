'use server'

import { updateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { MIME_TO_EXT, imageSize, sniffMime } from '@/lib/image'
import { createPhotoStorageKey } from '@/lib/photo-storage-key'
import {
  adminDeletePhoto,
  adminGetPhoto,
  adminInsertPhoto,
  adminListPhotos,
  adminListTournaments,
} from '@/lib/queries/content'
import { putObject, removeObject, uploadsEnabled } from '@/lib/storage'

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
      await removeObject(key).catch(cleanupError =>
        console.error('photo upload cleanup failed', cleanupError),
      )
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

  // Delete the database row first so guarded media access stops even if object cleanup fails.
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
