'use server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { clientFingerprint } from '@/lib/ratelimit'

export interface RegisterResult {
  ok: boolean
  error?: string
  seatsLeft?: number
  code?: 'RATE_LIMITED' | 'SUBMISSION_FAILED'
  retryAfterSeconds?: number
}

const FIELD_LIMITS = {
  name: 20,
  tag: 5,
  captain: 20,
  contact: 40,
  dept: 30,
  note: 120,
  player: 20,
} as const

function formText(form: FormData, name: string, maxLength: number) {
  const value = String(form.get(name) ?? '').trim()
  if (value.length > maxLength) throw new RangeError(`${name} exceeds its server-side limit`)
  return value
}

export async function registerTeam(slug: string, form: FormData): Promise<RegisterResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    return { ok: false, error: '当前赛事不存在或不可报名' }
  }

  let payload: Record<string, unknown>
  try {
    payload = {
      slug,
      name: formText(form, 'name', FIELD_LIMITS.name),
      tag: formText(form, 'tag', FIELD_LIMITS.tag),
      captain: formText(form, 'captain', FIELD_LIMITS.captain),
      contact: formText(form, 'contact', FIELD_LIMITS.contact),
      dept: formText(form, 'dept', FIELD_LIMITS.dept),
      note: formText(form, 'note', FIELD_LIMITS.note),
      players: [1, 2, 3, 4, 5, 6].map(index => ({
        nickname: formText(form, `player${index}`, FIELD_LIMITS.player),
        substitute: index === 6,
      })),
    }
  } catch {
    return { ok: false, error: '报名信息超出允许长度，请检查后重试' }
  }

  try {
    const fingerprint = await clientFingerprint()
    const { db } = cloudflareBindings()
    const tournament = await db
      .prepare(
        "SELECT id, team_cap AS teamCap, status FROM tournament WHERE slug = ? AND status != 'draft'",
      )
      .bind(slug)
      .first<{ id: number; teamCap: number; status: string }>()
    if (!tournament || !['registration', 'postponed'].includes(tournament.status)) {
      return { ok: false, error: '当前赛事未开放报名' }
    }
    const team = payload as {
      name: string
      tag: string
      captain: string
      contact: string
      dept: string
      note: string
      players: { nickname: string; substitute: boolean }[]
    }
    if (!team.name || !team.tag || !team.captain || !team.contact)
      return { ok: false, error: '请填写完整的必填项' }
    const tag = team.tag.toUpperCase()
    if (tag.length < 2 || tag.length > 5) return { ok: false, error: '战队 TAG 需要 2 到 5 个字符' }
    const duplicate = await db
      .prepare(
        'SELECT id FROM team WHERE tournament_id = ? AND (LOWER(name) = LOWER(?) OR UPPER(tag) = ?)',
      )
      .bind(tournament.id, team.name, tag)
      .first()
    if (duplicate) return { ok: false, error: '战队名称或 TAG 已被占用' }
    const statements = [
      db
        .prepare(
          'INSERT INTO registration_attempt (fingerprint,tournament_id,accepted) VALUES (?,?,1)',
        )
        .bind(fingerprint, tournament.id),
      db
        .prepare(
          "INSERT INTO team (tournament_id,name,tag,captain,contact,dept,note,status) VALUES (?,?,?,?,?,?,?,'pending')",
        )
        .bind(
          tournament.id,
          team.name,
          tag,
          team.captain,
          team.contact,
          team.dept || null,
          team.note || null,
        ),
      ...team.players
        .filter(player => player.nickname)
        .map((player, index) =>
          db
            .prepare(
              'INSERT INTO player (team_id,nickname,is_substitute,sort_order) SELECT id,?,?,? FROM team WHERE tournament_id = ? AND tag = ?',
            )
            .bind(player.nickname, player.substitute ? 1 : 0, index + 1, tournament.id, tag),
        ),
    ]
    await db.batch(statements)
    const taken = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM team WHERE tournament_id = ? AND status != 'rejected'",
      )
      .bind(tournament.id)
      .first<{ count: number }>()
    return {
      ok: true,
      seatsLeft: Math.max(0, tournament.teamCap - (taken?.count ?? tournament.teamCap)),
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
