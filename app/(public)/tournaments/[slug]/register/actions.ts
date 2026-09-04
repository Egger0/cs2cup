'use server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import { getMembershipState } from '@/lib/identity/membership-service'
import {
  RegistrationWorkflowError,
  saveRegistrationDraft,
} from '@/lib/identity/registration-workflow'
import { createApprovedTournamentRegistration } from '@/lib/identity/tournament-registration'
import { clientFingerprint } from '@/lib/ratelimit'
import { createRegistrationAccess } from '@/lib/registration-access'
import { parseRegistrationDraftForm, parseRegistrationForm } from '@/lib/registration-form'
import { registrationAvailability } from '@/lib/registration'

export interface RegisterResult {
  ok: boolean
  error?: string
  seatsLeft?: number
  managePath?: string
  code?: 'AUTH_REQUIRED' | 'MEMBERSHIP_REQUIRED' | 'RATE_LIMITED' | 'SUBMISSION_FAILED'
  redirectTo?: string
  retryAfterSeconds?: number
}

export interface RegistrationDraftResult {
  ok: boolean
  error?: string
  updatedAt?: number
  code?: 'AUTH_REQUIRED' | 'DRAFT_LOCKED' | 'SAVE_FAILED'
  redirectTo?: string
}

export async function saveTeamDraft(
  slug: string,
  form: FormData,
): Promise<RegistrationDraftResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    return { ok: false, code: 'DRAFT_LOCKED', error: '当前赛事不存在或无法保存草稿' }
  }
  const parsed = parseRegistrationDraftForm(form)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  try {
    const { db } = cloudflareBindings()
    const context = await getAuthContext({ database: db })
    if (context.kind === 'anonymous') {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        error: '登录已失效，请重新登录后保存。',
        redirectTo: `/login?redirectKey=registration&tournamentSlug=${encodeURIComponent(slug)}`,
      }
    }
    const tournament = await db
      .prepare('SELECT id FROM tournament WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first<{ id: number }>()
    if (!tournament) {
      return { ok: false, code: 'DRAFT_LOCKED', error: '当前赛事不存在或无法保存草稿' }
    }
    const saved = await saveRegistrationDraft(db, context, {
      tournamentId: tournament.id,
      values: parsed.values,
    })
    return { ok: true, updatedAt: saved.updatedAt }
  } catch (error) {
    if (error instanceof RegistrationWorkflowError) {
      if (error.code === 'reauth_required') {
        return {
          ok: false,
          code: 'AUTH_REQUIRED',
          error: '请先完成账号恢复或重新登录后保存。',
          redirectTo: '/account/security?recovery=1',
        }
      }
      if (error.code === 'locked') {
        return { ok: false, code: 'DRAFT_LOCKED', error: '报名已经截止，草稿未再修改。' }
      }
    }
    console.error('[registration] draft save unavailable', error)
    return { ok: false, code: 'SAVE_FAILED', error: '草稿暂时无法保存，请稍后重试。' }
  }
}

export async function registerTeam(slug: string, form: FormData): Promise<RegisterResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    return { ok: false, error: '当前赛事不存在或不可报名' }
  }

  try {
    const { db } = cloudflareBindings()
    const context = await getAuthContext({ database: db })
    if (context.kind === 'anonymous') {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        error: '登录已失效，请重新登录后提交报名。',
        redirectTo: `/login?redirectKey=registration&tournamentSlug=${encodeURIComponent(slug)}`,
      }
    }
    const membership = await getMembershipState(db, context)
    if (!membership.ok || membership.membership?.status !== 'approved') {
      return {
        ok: false,
        code: 'MEMBERSHIP_REQUIRED',
        error: '最终提交赛事报名前，需要先通过成员资格审核。',
        redirectTo: '/account',
      }
    }
    const parsed = parseRegistrationForm(form)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const team = parsed.values
    const tag = team.tag
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
    const now = Date.now()
    const created = await createApprovedTournamentRegistration(db, context, {
      tournamentId: tournament.id,
      team,
      managementTokenHash: access.tokenHash,
      fingerprint,
      now,
    })
    if (!created.ok) {
      return {
        ok: false,
        code: created.reason === 'authorization_changed' ? 'MEMBERSHIP_REQUIRED' : undefined,
        error:
          created.reason === 'authorization_changed'
            ? '报名资格或登录状态刚刚发生变化，请前往账号中心查看。'
            : '报名截止时间或赛事状态刚刚发生变化，请刷新后重试。',
        redirectTo: created.reason === 'authorization_changed' ? '/account' : undefined,
      }
    }
    const taken = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM team WHERE tournament_id = ? AND status != 'rejected'",
      )
      .bind(tournament.id)
      .first<{ count: number }>()
    return {
      ok: true,
      seatsLeft: Math.max(0, tournament.teamCap - (taken?.count ?? tournament.teamCap)),
      managePath: `/me/registrations/${created.teamId}`,
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
