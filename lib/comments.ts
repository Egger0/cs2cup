import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { CONTROL_CHARACTER } from './registration-form.ts'

export const COMMENT_SUBJECTS = ['post', 'match', 'team'] as const
export const COMMENT_HOURLY_LIMIT = 10

export type CommentSubject = (typeof COMMENT_SUBJECTS)[number]

export interface Comment {
  readonly id: number
  readonly body: string
  readonly authorId: string
  readonly authorName: string
  readonly authorHandle: string | null
  readonly hidden: boolean
  readonly createdAt: number
}

export function parseCommentSubject(kind: unknown, id: unknown) {
  const subjectId = Number(id)
  return COMMENT_SUBJECTS.includes(kind as CommentSubject) &&
    Number.isSafeInteger(subjectId) &&
    subjectId > 0
    ? { kind: kind as CommentSubject, id: subjectId }
    : null
}

export function parseCommentBody(raw: unknown) {
  const body = typeof raw === 'string' ? raw.trim().replace(/\r\n?/g, '\n') : ''
  const length = [...body].length
  return length < 1 || length > 300 || CONTROL_CHARACTER.test(body.replaceAll('\n', ' '))
    ? null
    : body
}

export async function listComments(
  database: IdentityDatabase,
  subject: { kind: CommentSubject; id: number },
  includeHidden: boolean,
): Promise<Comment[]> {
  const { results } = await database
    .prepare(
      `SELECT comment.id, comment.body, comment.account_id AS authorId,
              account.display_name AS authorName, account.public_handle AS authorHandle,
              comment.hidden_at IS NOT NULL AS hidden, comment.created_at AS createdAt
       FROM comment
       JOIN identity_account AS account ON account.id = comment.account_id
       WHERE comment.subject_kind = ? AND comment.subject_id = ? AND account.status = 'active'
         AND (? OR comment.hidden_at IS NULL)
       ORDER BY comment.created_at ASC, comment.id ASC LIMIT 200`,
    )
    .bind(subject.kind, subject.id, includeHidden ? 1 : 0)
    .all<Omit<Comment, 'hidden'> & { hidden: number }>()
  return results.map(row => ({ ...row, hidden: Boolean(row.hidden) }))
}

export async function postComment(
  database: IdentityDatabase,
  input: { kind: CommentSubject; id: number; accountId: string; body: string },
  now: number,
): Promise<{ ok: true } | { ok: false; reason: 'limit' | 'closed' }> {
  try {
    await database
      .prepare(
        `INSERT INTO comment (subject_kind, subject_id, account_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.kind, input.id, input.accountId, input.body, now)
      .run()
    return { ok: true }
  } catch (error) {
    if (!(error instanceof Error) || !/comment rejected/.test(error.message)) throw error
  }
  const recent = await database
    .prepare('SELECT COUNT(*) AS count FROM comment WHERE account_id = ? AND created_at > ?')
    .bind(input.accountId, now - 3_600_000)
    .first<{ count: number }>()
  return {
    ok: false,
    reason: Number(recent?.count ?? 0) >= COMMENT_HOURLY_LIMIT ? 'limit' : 'closed',
  }
}

export async function removeComment(
  database: IdentityDatabase,
  input: { commentId: number; accountId: string; moderator: boolean },
  now: number,
): Promise<boolean> {
  const row = input.moderator
    ? await database
        .prepare('UPDATE comment SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL RETURNING id')
        .bind(now, input.commentId)
        .first()
    : await database
        .prepare('DELETE FROM comment WHERE id = ? AND account_id = ? RETURNING id')
        .bind(input.commentId, input.accountId)
        .first()
  return Boolean(row)
}
