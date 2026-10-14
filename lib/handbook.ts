import 'server-only'

import { cloudflareBindings } from './cloudflare-bindings'
import { requireProjectContentAccess } from './project-content-access'

export const HANDBOOK_KINDS = {
  handbook: { label: '赛事手册', lede: '从立项到颁奖，一场比赛怎么办下来。' },
  template: { label: '办赛模板', lede: '策划案、报名表、赛程表，拿去改成你的。' },
} as const

export type HandbookKind = keyof typeof HANDBOOK_KINDS

export interface HandbookDocument {
  id: number
  gameId: number | null
  kind: HandbookKind
  title: string
  summary: string
  storageKey: string | null
  fileName: string | null
  byteSize: number | null
  url: string | null
}

const COLUMNS = `id, game_id AS gameId, kind, title, summary, storage_key AS storageKey, file_name AS fileName,
  byte_size AS byteSize, url`

export async function listHandbookDocuments() {
  const { results } = await cloudflareBindings()
    .db.prepare(`SELECT ${COLUMNS} FROM handbook_document ORDER BY kind, created_at, id`)
    .bind()
    .all<HandbookDocument>()
  return results
}

export function findHandbookDocument(id: number) {
  return cloudflareBindings()
    .db.prepare(`SELECT ${COLUMNS} FROM handbook_document WHERE id = ?`)
    .bind(id)
    .first<HandbookDocument>()
}

export async function insertHandbookDocument(document: Omit<HandbookDocument, 'id'>) {
  await requireProjectContentAccess(document.gameId)
  return cloudflareBindings()
    .db.prepare(
      `INSERT INTO handbook_document (game_id, kind, title, summary, storage_key, file_name, byte_size, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      document.gameId,
      document.kind,
      document.title,
      document.summary,
      document.storageKey,
      document.fileName,
      document.byteSize,
      document.url,
    )
    .run()
}

export async function deleteHandbookDocument(id: number) {
  const document = await findHandbookDocument(id)
  if (!document) throw new Error('文档不存在或已被删除')
  await requireProjectContentAccess(document.gameId)
  return cloudflareBindings()
    .db.prepare('DELETE FROM handbook_document WHERE id = ? AND game_id IS ?')
    .bind(id, document.gameId)
    .run()
}
