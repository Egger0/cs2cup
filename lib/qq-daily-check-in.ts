import 'server-only'

import { evaluateUsernamePolicy } from './identity/internal/username-policy.ts'
import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { dailyCheckIn } from './stardust.ts'
import { previousDate, shanghaiDate } from './qq-automation.ts'

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
  | { kind: 'checked_in'; streak: number; rank: number; reward: number }

export interface QqLeaderboardEntry {
  displayName: string
  streak: number
  lastCheckInDate: string
}

export interface QqRegistrationSummary {
  tournamentSlug: string
  tournamentTitle: string
  teamName: string
  teamTag: string
  status: 'pending' | 'approved' | 'rejected'
  checkedInAt: string | null
}

interface LinkRow {
  account_id: string
}

interface RegistrationSummaryRow {
  tournament_slug: string
  tournament_title: string
  team_name: string
  team_tag: string
  team_status: 'pending' | 'approved' | 'rejected'
  checked_in_at: string | null
}

function validOpenId(value: string) {
  return value.length > 0 && value.length <= 256 && value === value.trim()
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

export async function qqLinkedAccountId(
  database: IdentityDatabase,
  groupOpenId: string,
  memberOpenId: string,
) {
  if (!validOpenId(groupOpenId) || !validOpenId(memberOpenId)) return null
  return (await activeLink(database, groupOpenId, memberOpenId))?.account_id ?? null
}

export async function qqAccountRegistrations(
  database: IdentityDatabase,
  accountId: string,
  now = Date.now(),
): Promise<QqRegistrationSummary[]> {
  if (!validOpenId(accountId) || !Number.isSafeInteger(now) || now < 0) return []
  const rows = await database
    .prepare(
      `SELECT DISTINCT tournament.slug AS tournament_slug, tournament.title AS tournament_title,
              team.name AS team_name, team.tag AS team_tag, team.status AS team_status,
              team.checked_in_at
       FROM identity_registration_membership AS membership
       JOIN team ON team.id = membership.team_id
       JOIN tournament ON tournament.id = team.tournament_id
       WHERE membership.account_id = ? AND membership.revoked_at IS NULL
         AND membership.granted_at <= ?
         AND (membership.expires_at IS NULL OR membership.expires_at > ?)
       ORDER BY team.created_at DESC, team.id DESC
       LIMIT 3`,
    )
    .bind(accountId, now, now)
    .all<RegistrationSummaryRow>()
  return rows.results.map(row => ({
    tournamentSlug: row.tournament_slug,
    tournamentTitle: row.tournament_title,
    teamName: row.team_name,
    teamTag: row.team_tag,
    status: row.team_status,
    checkedInAt: row.checked_in_at,
  }))
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
  const checkIn = await dailyCheckIn(database, link.account_id, now)
  if (!checkIn.fresh) return { kind: 'already_checked_in', streak: checkIn.streak }
  const today = shanghaiDate(now)
  const yesterday = previousDate(today)
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
    .bind(input.groupOpenId, today, yesterday, checkIn.streak, checkIn.streak, checkIn.signedAt)
    .first<{ count: number }>()
  return {
    kind: 'checked_in',
    streak: checkIn.streak,
    rank: Number(ahead?.count ?? 0) + 1,
    reward: checkIn.reward,
  }
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
