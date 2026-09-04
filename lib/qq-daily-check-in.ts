import 'server-only'

import { evaluateUsernamePolicy } from './identity/internal/username-policy.ts'
import type { IdentityDatabase } from './identity/internal/contracts.ts'

const SHANGHAI = 'Asia/Shanghai'

export type QqLinkResult =
  | { ok: true }
  | {
      ok: false
      reason: 'invalid_username' | 'username_not_found' | 'already_bound' | 'account_bound'
    }

export type QqUnlinkResult = { ok: true } | { ok: false; reason: 'not_bound' }

export type QqCheckInResult =
  | { kind: 'unbound' }
  | { kind: 'already_checked_in'; streak: number }
  | { kind: 'checked_in'; streak: number; rank: number }

export interface QqLeaderboardEntry {
  displayName: string
  streak: number
  lastCheckInDate: string
}

interface LinkRow {
  account_id: string
}

interface StreakRow {
  current_streak: number
  last_check_in_date: string
  last_signed_at: number
}

function validOpenId(value: string) {
  return value.length > 0 && value.length <= 256 && value === value.trim()
}

function shanghaiDate(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function previousDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

async function activeLink(database: IdentityDatabase, groupOpenId: string, memberOpenId: string) {
  return database
    .prepare(
      `SELECT link.account_id
       FROM qq_account_link AS link
       JOIN identity_account AS account ON account.id = link.account_id
       WHERE link.group_openid = ? AND link.member_openid = ? AND account.status = 'active'
       LIMIT 1`,
    )
    .bind(groupOpenId, memberOpenId)
    .first<LinkRow>()
}

export async function linkQqAccountByUsername(
  database: IdentityDatabase,
  input: { groupOpenId: string; memberOpenId: string; username: string },
  now = Date.now(),
): Promise<QqLinkResult> {
  const { groupOpenId, memberOpenId } = input
  const username = evaluateUsernamePolicy(input.username)
  if (!validOpenId(groupOpenId) || !validOpenId(memberOpenId) || !username.ok)
    return { ok: false, reason: 'invalid_username' }
  if (await activeLink(database, groupOpenId, memberOpenId))
    return { ok: false, reason: 'already_bound' }
  const candidate = await database
    .prepare(
      `SELECT account.id AS account_id
       FROM identity_password_credential AS credential
       JOIN identity_account AS account ON account.id = credential.account_id
       WHERE credential.username = ? AND account.status = 'active'
       LIMIT 1`,
    )
    .bind(username.username)
    .first<LinkRow>()
  if (!candidate) return { ok: false, reason: 'username_not_found' }
  const accountLinked = await database
    .prepare('SELECT 1 AS present FROM qq_account_link WHERE account_id = ? LIMIT 1')
    .bind(candidate.account_id)
    .first<{ present: number }>()
  if (accountLinked) return { ok: false, reason: 'account_bound' }

  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO qq_account_link (account_id, group_openid, member_openid, linked_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(candidate.account_id, groupOpenId, memberOpenId, now),
  ])
  const linked = await activeLink(database, groupOpenId, memberOpenId)
  return linked?.account_id === candidate.account_id
    ? { ok: true }
    : { ok: false, reason: 'already_bound' }
}

export async function unlinkQqAccount(
  database: IdentityDatabase,
  input: { groupOpenId: string; memberOpenId: string },
): Promise<QqUnlinkResult> {
  const { groupOpenId, memberOpenId } = input
  if (!validOpenId(groupOpenId) || !validOpenId(memberOpenId))
    return { ok: false, reason: 'not_bound' }
  if (!(await activeLink(database, groupOpenId, memberOpenId)))
    return { ok: false, reason: 'not_bound' }
  await database
    .prepare('DELETE FROM qq_account_link WHERE group_openid = ? AND member_openid = ?')
    .bind(groupOpenId, memberOpenId)
    .run()
  return (await activeLink(database, groupOpenId, memberOpenId))
    ? { ok: false, reason: 'not_bound' }
    : { ok: true }
}

export async function checkInFromQq(
  database: IdentityDatabase,
  input: { groupOpenId: string; memberOpenId: string },
  now = Date.now(),
): Promise<QqCheckInResult> {
  const link = await activeLink(database, input.groupOpenId, input.memberOpenId)
  if (!link) return { kind: 'unbound' }
  const today = shanghaiDate(now)
  const yesterday = previousDate(today)
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO qq_daily_check_in (account_id, check_in_date, signed_at)
         VALUES (?, ?, ?)`,
      )
      .bind(link.account_id, today, now),
    database
      .prepare(
        `INSERT INTO qq_check_in_streak (account_id, current_streak, last_check_in_date, last_signed_at)
         SELECT ?, CASE
           WHEN (SELECT last_check_in_date FROM qq_check_in_streak WHERE account_id = ?) = ?
             THEN COALESCE((SELECT current_streak FROM qq_check_in_streak WHERE account_id = ?), 0) + 1
           ELSE 1
         END, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM qq_daily_check_in
           WHERE account_id = ? AND check_in_date = ? AND signed_at = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM qq_check_in_streak
           WHERE account_id = ? AND last_check_in_date = ?
         )
         ON CONFLICT(account_id) DO UPDATE SET
           current_streak = excluded.current_streak,
           last_check_in_date = excluded.last_check_in_date,
           last_signed_at = excluded.last_signed_at`,
      )
      .bind(
        link.account_id,
        link.account_id,
        yesterday,
        link.account_id,
        today,
        now,
        link.account_id,
        today,
        now,
        link.account_id,
        today,
      ),
  ])
  const streak = await database
    .prepare(
      `SELECT current_streak, last_check_in_date, last_signed_at
       FROM qq_check_in_streak WHERE account_id = ? LIMIT 1`,
    )
    .bind(link.account_id)
    .first<StreakRow>()
  if (!streak) throw new Error('QQ check-in streak was not recorded')
  if (streak.last_signed_at !== now)
    return { kind: 'already_checked_in', streak: streak.current_streak }
  const ahead = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM qq_check_in_streak AS streak
       JOIN qq_account_link AS link ON link.account_id = streak.account_id
       JOIN identity_account AS account ON account.id = streak.account_id
       WHERE link.group_openid = ? AND account.status = 'active'
         AND streak.last_check_in_date IN (?, ?)
         AND (streak.current_streak > ?
           OR (streak.current_streak = ? AND streak.last_signed_at < ?))`,
    )
    .bind(
      input.groupOpenId,
      today,
      yesterday,
      streak.current_streak,
      streak.current_streak,
      streak.last_signed_at,
    )
    .first<{ count: number }>()
  return { kind: 'checked_in', streak: streak.current_streak, rank: Number(ahead?.count ?? 0) + 1 }
}

export async function qqCheckInLeaderboard(
  database: IdentityDatabase,
  groupOpenId: string,
  now = Date.now(),
): Promise<QqLeaderboardEntry[]> {
  const today = shanghaiDate(now)
  const yesterday = previousDate(today)
  const rows = await database
    .prepare(
      `SELECT account.display_name, streak.current_streak, streak.last_check_in_date
       FROM qq_check_in_streak AS streak
       JOIN qq_account_link AS link ON link.account_id = streak.account_id
       JOIN identity_account AS account ON account.id = streak.account_id
       WHERE link.group_openid = ? AND account.status = 'active'
         AND streak.last_check_in_date IN (?, ?)
       ORDER BY streak.current_streak DESC, streak.last_signed_at ASC, account.id ASC
       LIMIT 10`,
    )
    .bind(groupOpenId, today, yesterday)
    .all<{ display_name: string; current_streak: number; last_check_in_date: string }>()
  return rows.results.map(row => ({
    displayName: row.display_name,
    streak: row.current_streak,
    lastCheckInDate: row.last_check_in_date,
  }))
}
