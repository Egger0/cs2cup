import 'server-only'

import { hashOpaqueToken } from './opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './identity/internal/contracts.ts'

const BINDING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const BINDING_CODE_LENGTH = 8
const BINDING_CODE_LIFETIME_MS = 10 * 60 * 1000
const SHANGHAI = 'Asia/Shanghai'

export type QqBindingCodeResult =
  | { ok: true; code: string; expiresAt: number }
  | { ok: false; reason: 'session_invalid' | 'recovery_restricted' }

export type QqLinkResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_code' | 'already_bound' | 'account_bound' }

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

function randomCode() {
  const bytes = new Uint8Array(BINDING_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => BINDING_CODE_ALPHABET[byte % BINDING_CODE_ALPHABET.length]).join(
    '',
  )
}

function codeHash(code: string) {
  return hashOpaqueToken(`qq.binding\0${code}`)
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

export async function generateQqBindingCode(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
): Promise<QqBindingCodeResult> {
  if (context.session.recoveryRestricted) return { ok: false, reason: 'recovery_restricted' }
  const code = randomCode()
  const hash = await codeHash(code)
  const expiresAt = now + BINDING_CODE_LIFETIME_MS
  await database.batch([
    database.prepare('DELETE FROM qq_binding_code WHERE account_id = ?').bind(context.account.id),
    database
      .prepare(
        `INSERT INTO qq_binding_code (code_hash, account_id, expires_at, created_at)
         SELECT ?, account.id, ?, ?
         FROM identity_account AS account
         JOIN identity_session AS session ON session.account_id = account.id
         WHERE account.id = ? AND account.status = 'active' AND session.id = ?
           AND session.revoked_at IS NULL AND session.recovery_restricted = 0
           AND session.security_version = account.security_version
           AND session.idle_expires_at > ? AND session.absolute_expires_at > ?`,
      )
      .bind(hash, expiresAt, now, context.account.id, context.session.id, now, now),
  ])
  const stored = await database
    .prepare('SELECT 1 AS present FROM qq_binding_code WHERE code_hash = ? AND account_id = ?')
    .bind(hash, context.account.id)
    .first<{ present: number }>()
  return stored ? { ok: true, code, expiresAt } : { ok: false, reason: 'session_invalid' }
}

export async function linkQqAccount(
  database: IdentityDatabase,
  input: { groupOpenId: string; memberOpenId: string; code: string },
  now = Date.now(),
): Promise<QqLinkResult> {
  const { groupOpenId, memberOpenId } = input
  const code = input.code.trim().toUpperCase()
  if (
    !validOpenId(groupOpenId) ||
    !validOpenId(memberOpenId) ||
    !/^[A-HJ-NP-Z2-9]{8}$/.test(code)
  ) {
    return { ok: false, reason: 'invalid_code' }
  }
  if (await activeLink(database, groupOpenId, memberOpenId))
    return { ok: false, reason: 'already_bound' }
  const hash = await codeHash(code)
  const candidate = await database
    .prepare(
      `SELECT code.account_id
       FROM qq_binding_code AS code
       JOIN identity_account AS account ON account.id = code.account_id
       WHERE code.code_hash = ? AND code.expires_at > ? AND account.status = 'active'
       LIMIT 1`,
    )
    .bind(hash, now)
    .first<LinkRow>()
  if (!candidate) return { ok: false, reason: 'invalid_code' }
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
    database.prepare('DELETE FROM qq_binding_code WHERE code_hash = ?').bind(hash),
  ])
  const linked = await activeLink(database, groupOpenId, memberOpenId)
  return linked?.account_id === candidate.account_id
    ? { ok: true }
    : { ok: false, reason: 'already_bound' }
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
