import 'server-only'

import { cloudflareBindings } from './cloudflare-bindings'

export const HANDBOOK_KINDS = {
  handbook: { label: '赛事手册', lede: '从立项到颁奖，一场比赛怎么办下来。' },
  template: { label: '办赛模板', lede: '策划案、报名表、赛程表，拿去改成你的。' },
} as const

export type HandbookKind = keyof typeof HANDBOOK_KINDS

export interface HandbookDocument {
  id: number
  kind: HandbookKind
  title: string
  summary: string
  storageKey: string | null
  fileName: string | null
  byteSize: number | null
  url: string | null
}

const COLUMNS = `id, kind, title, summary, storage_key AS storageKey, file_name AS fileName,
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

export function insertHandbookDocument(document: Omit<HandbookDocument, 'id'>) {
  return cloudflareBindings()
    .db.prepare(
      `INSERT INTO handbook_document (kind, title, summary, storage_key, file_name, byte_size, url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
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

export function deleteHandbookDocument(id: number) {
  return cloudflareBindings()
    .db.prepare('DELETE FROM handbook_document WHERE id = ?')
    .bind(id)
    .run()
}
