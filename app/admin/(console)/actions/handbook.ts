'use server'

import { requirePlatformConsole } from '@/lib/auth'
import { requireProjectContentAccess } from '@/lib/project-content-access'
import {
  HANDBOOK_KINDS,
  deleteHandbookDocument,
  findHandbookDocument,
  insertHandbookDocument,
  type HandbookKind,
} from '@/lib/handbook'
import { HANDBOOK_MAX_BYTES, handbookFileMatches, handbookFileType } from '@/lib/handbook-file'
import { putObject, removeObject, uploadsEnabled } from '@/lib/storage'

function externalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export async function createHandbookDocument(form: FormData) {
  await requirePlatformConsole()

  const selectedGame = String(form.get('gameId') ?? '')
  const gameId = selectedGame === '' ? null : Number(selectedGame)
  if (gameId !== null && (!Number.isSafeInteger(gameId) || gameId <= 0)) {
    return { ok: false as const, error: '请选择归属项目' }
  }
  await requireProjectContentAccess(gameId)

  const kind = String(form.get('kind') ?? '')
  const title = String(form.get('title') ?? '').trim()
  const summary = String(form.get('summary') ?? '').trim()
  const link = String(form.get('url') ?? '').trim()
  const file = form.get('file')
  const hasFile = file instanceof File && file.size > 0

  if (!(kind in HANDBOOK_KINDS)) return { ok: false as const, error: '请选择文档类别' }
  if (!title || title.length > 80) return { ok: false as const, error: '标题需要 1 到 80 个字' }
  if (summary.length > 300) return { ok: false as const, error: '简介不能超过 300 个字' }
  if (hasFile === Boolean(link)) {
    return { ok: false as const, error: '上传文件和外部链接二选一' }
  }

  const base = { gameId, kind: kind as HandbookKind, title, summary }
  if (!hasFile) {
    const url = externalUrl(link)
    if (!url) return { ok: false as const, error: '外部链接需要以 https:// 开头' }
    await insertHandbookDocument({ ...base, storageKey: null, fileName: null, byteSize: null, url })
    return { ok: true as const }
  }

  if (!uploadsEnabled()) return { ok: false as const, error: '没有配置上传存储' }
  if (file.size > HANDBOOK_MAX_BYTES) return { ok: false as const, error: '文件不要超过 10 MB' }
  const type = handbookFileType(file.name)
  const buffer = Buffer.from(await file.arrayBuffer())
  if (!type || !handbookFileMatches(type, buffer)) {
    return {
      ok: false as const,
      error: '只支持 PDF、Word、Excel、PowerPoint、ZIP、Markdown 和 TXT',
    }
  }

  const storageKey = `handbook/${crypto.randomUUID()}.${type}`
  try {
    await putObject(storageKey, buffer, 'application/octet-stream')
    await insertHandbookDocument({
      ...base,
      storageKey,
      fileName: file.name.slice(-120),
      byteSize: file.size,
      url: null,
    })
  } catch (error) {
    console.error('handbook upload failed', error)
    await removeObject(storageKey).catch(() => {})
    return { ok: false as const, error: '文档保存失败，请稍后重试' }
  }
  return { ok: true as const }
}

export async function removeHandbookDocument(id: number) {
  await requirePlatformConsole()
  const document = Number.isSafeInteger(id) && id > 0 ? await findHandbookDocument(id) : null
  if (!document) return { ok: false as const, error: '文档不存在或已被删除' }
  await requireProjectContentAccess(document.gameId)

  await deleteHandbookDocument(id)
  if (document.storageKey) {
    await removeObject(document.storageKey).catch(error =>
      console.error(`orphaned handbook object requires cleanup: ${document.storageKey}`, error),
    )
  }
  return { ok: true as const }
}
