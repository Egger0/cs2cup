import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { CONTROL_CHARACTER } from './registration-form.ts'

export function parseBio(raw: unknown) {
  const bio = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  const length = [...bio].length
  if (length === 0) return { ok: true as const, bio: null }
  return length > 120 || CONTROL_CHARACTER.test(bio) ? null : { ok: true as const, bio }
}

export async function getBio(database: IdentityDatabase, accountId: string) {
  const row = await database
    .prepare('SELECT bio FROM account_bio WHERE account_id = ?')
    .bind(accountId)
    .first<{ bio: string }>()
  return row?.bio ?? null
}

export async function setBio(
  database: IdentityDatabase,
  accountId: string,
  bio: string | null,
  now: number,
) {
  if (bio === null) {
    await database.prepare('DELETE FROM account_bio WHERE account_id = ?').bind(accountId).run()
    return
  }
  await database
    .prepare(
      `INSERT INTO account_bio (account_id, bio, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at`,
    )
    .bind(accountId, bio, now)
    .run()
}

export type FollowPlayerResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' | 'self' | 'limit' }

export async function setPlayerFollow(
  database: IdentityDatabase,
  input: { followerId: string; handle: string; follow: boolean },
  now: number,
): Promise<FollowPlayerResult> {
  const target = await database
    .prepare("SELECT id FROM identity_account WHERE public_handle = ? AND status = 'active'")
    .bind(input.handle)
    .first<{ id: string }>()
  if (!target) return { ok: false, reason: 'not_found' }
  if (target.id === input.followerId) return { ok: false, reason: 'self' }
  if (!input.follow) {
    await database
      .prepare(
        'DELETE FROM player_follow WHERE follower_account_id = ? AND followed_account_id = ?',
      )
      .bind(input.followerId, target.id)
      .run()
    return { ok: true }
  }
  try {
    await database
      .prepare(
        `INSERT INTO player_follow (follower_account_id, followed_account_id, created_at)
         VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(input.followerId, target.id, now)
      .run()
    return { ok: true }
  } catch (error) {
    if (error instanceof Error && /player follow rejected/.test(error.message)) {
      return { ok: false, reason: 'limit' }
    }
    throw error
  }
}

export async function followedHandles(database: IdentityDatabase, followerId: string) {
  const { results } = await database
    .prepare(
      `SELECT account.public_handle AS handle FROM player_follow AS follow
       JOIN identity_account AS account ON account.id = follow.followed_account_id
       WHERE follow.follower_account_id = ? AND account.public_handle IS NOT NULL
       ORDER BY follow.created_at ASC`,
    )
    .bind(followerId)
    .all<{ handle: string }>()
  return results.map(row => row.handle)
}

export async function followerCount(database: IdentityDatabase, accountId: string) {
  const row = await database
    .prepare('SELECT COUNT(*) AS count FROM player_follow WHERE followed_account_id = ?')
    .bind(accountId)
    .first<{ count: number }>()
  return Number(row?.count ?? 0)
}
