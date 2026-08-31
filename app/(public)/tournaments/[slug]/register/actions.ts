'use server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { clientFingerprint } from '@/lib/ratelimit'
import { createRegistrationAccess } from '@/lib/registration-access'
import { parseRegistrationForm } from '@/lib/registration-form'
import { registrationAvailability } from '@/lib/registration'

export interface RegisterResult {
  ok: boolean
  error?: string
  seatsLeft?: number
  managementPath?: string
  code?: 'RATE_LIMITED' | 'SUBMISSION_FAILED'
  retryAfterSeconds?: number
}

export async function registerTeam(slug: string, form: FormData): Promise<RegisterResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    return { ok: false, error: '当前赛事不存在或不可报名' }
  }

  const parsed = parseRegistrationForm(form)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const team = parsed.values
  const tag = team.tag

  try {
    const { db } = cloudflareBindings()
    const tournament = await db
      .prepare(
        "SELECT t.id, t.team_cap AS teamCap, t.status, t.reg_deadline AS regDeadline, COUNT(team.id) AS taken, unixepoch('now') * 1000 AS nowMs FROM tournament t LEFT JOIN team ON team.tournament_id = t.id AND team.status != 'rejected' WHERE t.slug = ? GROUP BY t.id",
      )
      .bind(slug)
      .first<{
        id: number
        teamCap: number
        status: string
        regDeadline: string | null
        taken: number
        nowMs: number
      }>()
    if (!tournament) return { ok: false, error: '当前赛事不存在或不可报名' }

    const availability = registrationAvailability(tournament, tournament.taken, tournament.nowMs)
    if (!availability.open) {
      if (availability.reason === 'capacity_reached') return { ok: false, error: '席位已满' }
      if (availability.reason === 'deadline_passed') return { ok: false, error: '报名已截止' }
      if (availability.reason === 'invalid_configuration') {
        return { ok: false, error: '报名配置无效，请联系赛事负责人' }
      }
      return { ok: false, error: '当前赛事未开放报名' }
    }

    const fingerprint = await clientFingerprint()
    const duplicate = await db
      .prepare(
        'SELECT id FROM team WHERE tournament_id = ? AND (LOWER(name) = LOWER(?) OR UPPER(tag) = ?)',
      )
      .bind(tournament.id, team.name, tag)
      .first()
    if (duplicate) return { ok: false, error: '战队名称或 TAG 已被占用' }
    const access = await createRegistrationAccess()
    const statements = [
      db
        .prepare(
          "INSERT INTO team (tournament_id,name,tag,captain,contact,dept,note,status,management_token_hash) SELECT id,?,?,?,?,?,?,'pending',? FROM tournament WHERE id = ? AND status IN ('registration','postponed') AND (reg_deadline IS NULL OR unixepoch(reg_deadline) > unixepoch('now'))",
        )
        .bind(
          team.name,
          tag,
          team.captain,
          team.contact,
          team.dept || null,
          team.note || null,
          access.tokenHash,
          tournament.id,
        ),
      ...team.players.map((player, index) =>
        db
          .prepare(
            'INSERT INTO player (team_id,nickname,is_substitute,sort_order) SELECT id,?,?,? FROM team WHERE tournament_id = ? AND tag = ? AND management_token_hash = ?',
          )
          .bind(
            player.nickname,
            player.substitute ? 1 : 0,
            index + 1,
            tournament.id,
            tag,
            access.tokenHash,
          ),
      ),
      db
        .prepare(
          'INSERT INTO registration_attempt (fingerprint,tournament_id,accepted) SELECT ?,tournament_id,1 FROM team WHERE tournament_id = ? AND tag = ? AND management_token_hash = ?',
        )
        .bind(fingerprint, tournament.id, tag, access.tokenHash),
    ]
    await db.batch(statements)
    const [inserted, taken] = await Promise.all([
      db
        .prepare(
          'SELECT id FROM team WHERE tournament_id = ? AND tag = ? AND management_token_hash = ?',
        )
        .bind(tournament.id, tag, access.tokenHash)
        .first(),
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM team WHERE tournament_id = ? AND status != 'rejected'",
        )
        .bind(tournament.id)
        .first<{ count: number }>(),
    ])
    if (!inserted) return { ok: false, error: '报名已截止或赛事状态已变更，请刷新后重试' }
    return {
      ok: true,
      seatsLeft: Math.max(0, tournament.teamCap - (taken?.count ?? tournament.teamCap)),
      managementPath: `/tournaments/${encodeURIComponent(slug)}/registration/${access.token}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('提交太频繁')) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        error: '提交太频繁。每 60 分钟最多尝试 3 次，请稍后再试。',
        retryAfterSeconds: 3600,
      }
    }
    if (message.includes('席位已满')) return { ok: false, error: '席位已满' }
    if (message.includes('UNIQUE constraint failed')) {
      return { ok: false, error: '战队名称或 TAG 已被占用' }
    }
    console.error('[registration] guarded submission unavailable', error)

    return {
      ok: false,
      code: 'SUBMISSION_FAILED',
      error: '报名服务暂时不可用，请稍后再试；如问题持续，请联系赛事负责人。',
    }
  }
}
