'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { SESSION_COOKIE, requireAdmin, verifyToken } from '@/lib/auth'
import {
  clearMatches,
  listAdminMatches,
  removeTeam,
  saveMatchScore,
  saveTournament,
  setTeamSeed,
  setTeamStatus,
  removePhoto,
} from '@/lib/queries/admin'
import { decideWinner, downstreamOf } from '@/lib/bracket'
import { selectRows } from '@/lib/rdb'
import type { Match, TeamStatus, TournamentStatus } from '@/lib/types'

const SESSION_MAX_AGE = 60 * 60 * 8

async function passwordToken(username: string, password: string) {
  const env = process.env.CLOUDBASE_ENV_ID
  if (!env) return null

  try {
    const response = await fetch(`https://${env}.api.tcloudbasegateway.com/auth/v1/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    })
    if (!response.ok) return null

    const payload = (await response.json()) as { access_token?: unknown }
    return typeof payload.access_token === 'string' ? payload.access_token : null
  } catch {
    return null
  }
}

export async function signIn(username: string, password: string) {
  const token = await passwordToken(username, password)
  if (!token) return { ok: false as const, error: '登录凭证无效' }

  const claims = await verifyToken(token)
  if (!claims) return { ok: false as const, error: '登录凭证无效' }

  const rows = await selectRows<{ user_id: string }>('admin_user', {
    select: 'user_id',
    credential: 'admin',
    revalidate: false,
  })
  if (!rows.some(row => row.user_id === claims.sub)) {
    return { ok: false as const, error: '该账号不在管理员白名单中' }
  }

  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })

  return { ok: true as const }
}

export async function signOut() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  redirect('/admin/login')
}

export async function updateTeamStatus(id: number, status: TeamStatus, tournamentId: number) {
  await requireAdmin()
  await setTeamStatus(id, status)
  updateTag(`teams:${tournamentId}`)
}

export async function updateTeamSeed(id: number, seed: number | null, tournamentId: number) {
  await requireAdmin()
  await setTeamSeed(id, seed)
  updateTag(`teams:${tournamentId}`)
}

export async function deleteTeam(id: number, tournamentId: number) {
  await requireAdmin()
  await removeTeam(id)
  updateTag(`teams:${tournamentId}`)
}

export async function updateTournament(
  id: number,
  values: { title?: string; status?: TournamentStatus; teamCap?: number; lede?: string },
) {
  await requireAdmin()
  await saveTournament(id, values)
  updateTag('tournament')
}

export async function recordScore(
  matchId: number,
  scoreA: number | null,
  scoreB: number | null,
  tournamentId: number,
) {
  await requireAdmin()

  const matches = await listAdminMatches(tournamentId)
  const target = matches.find(match => match.id === matchId)
  if (!target) return { ok: false as const, error: '比赛不存在' }

  const updated: Match = { ...target, scoreA, scoreB }
  const winner = decideWinner(updated)

  await saveMatchScore(matchId, scoreA, scoreB, winner)
  await clearMatches(downstreamOf(matchId, matches))

  updateTag(`matches:${tournamentId}`)
  return { ok: true as const }
}

export async function deletePhoto(id: number) {
  await requireAdmin()
  await removePhoto(id)
  updateTag('photo')
}
