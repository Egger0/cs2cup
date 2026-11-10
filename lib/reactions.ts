import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'

export const REACTIONS = ['fire', 'like', 'clap', 'heart', 'laugh'] as const
export const REACTION_SUBJECTS = ['post', 'match', 'team', 'comment'] as const

export type Reaction = (typeof REACTIONS)[number]
export type ReactionSubject = (typeof REACTION_SUBJECTS)[number]

export interface ReactionSummary {
  readonly counts: Partial<Record<Reaction, number>>
  readonly mine: Reaction | null
}

export function parseReaction(raw: unknown): Reaction | null {
  return REACTIONS.includes(raw as Reaction) ? (raw as Reaction) : null
}

export function parseReactionSubject(kind: unknown, id: unknown) {
  const subjectId = Number(id)
  return REACTION_SUBJECTS.includes(kind as ReactionSubject) &&
    Number.isSafeInteger(subjectId) &&
    subjectId > 0
    ? { kind: kind as ReactionSubject, id: subjectId }
    : null
}

export async function summarizeReactions(
  database: IdentityDatabase,
  kind: ReactionSubject,
  ids: readonly number[],
  viewerId: string | null,
): Promise<Record<number, ReactionSummary>> {
  const unique = [...new Set(ids)].slice(0, 200)
  const summary: Record<
    number,
    { counts: Partial<Record<Reaction, number>>; mine: Reaction | null }
  > = Object.fromEntries(unique.map(id => [id, { counts: {}, mine: null }]))
  if (!unique.length) return summary
  const { results } = await database
    .prepare(
      `SELECT subject_id AS id, emoji, COUNT(*) AS count, MAX(account_id = ?) AS mine
       FROM reaction
       WHERE subject_kind = ? AND subject_id IN (SELECT value FROM json_each(?))
       GROUP BY subject_id, emoji`,
    )
    .bind(viewerId ?? '', kind, JSON.stringify(unique))
    .all<{ id: number; emoji: Reaction; count: number; mine: number }>()
  for (const row of results) {
    const entry = summary[row.id]
    if (!entry) continue
    entry.counts[row.emoji] = Number(row.count)
    if (row.mine) entry.mine = row.emoji
  }
  return summary
}

export async function setReaction(
  database: IdentityDatabase,
  input: { kind: ReactionSubject; id: number; accountId: string; emoji: Reaction | null },
  now: number,
): Promise<boolean> {
  if (!input.emoji) {
    await database
      .prepare('DELETE FROM reaction WHERE subject_kind = ? AND subject_id = ? AND account_id = ?')
      .bind(input.kind, input.id, input.accountId)
      .run()
    return true
  }
  try {
    await database
      .prepare(
        `INSERT INTO reaction (subject_kind, subject_id, account_id, emoji, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (subject_kind, subject_id, account_id)
         DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
      )
      .bind(input.kind, input.id, input.accountId, input.emoji, now)
      .run()
    return true
  } catch (error) {
    if (error instanceof Error && /reaction rejected/.test(error.message)) return false
    throw error
  }
}
