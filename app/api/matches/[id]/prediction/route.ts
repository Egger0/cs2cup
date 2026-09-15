import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { currentTimeMillis } from '@/lib/current-time'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'
import { matchPredictionBoard, placeMatchPrediction } from '@/lib/match-prediction'

const FAILURES = {
  invalid_stake: '应援数量需为 1–1000 的整数。',
  membership_required: '成员资格审核通过后才能参与赛前预测。',
  already_placed: '这场比赛你已经应援过了，赛果出炉前不能更改。',
  insufficient_balance: '星尘不足，先去签到领取吧。',
  closed: '这场比赛的预测已经截止。',
} as const

function json(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
}

function matchIdOf(value: string) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function viewer(request: NextRequest) {
  const context = await getAuthContext({
    token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
  })
  return context.kind === 'authenticated' && !context.session.recoveryRestricted
    ? context.account.id
    : null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const matchId = matchIdOf((await params).id)
  if (!matchId) return json({ ok: false, error: '比赛不存在。' }, 404)
  try {
    const db = cloudflareBindings().db
    const board = await matchPredictionBoard(
      db,
      matchId,
      await viewer(request),
      currentTimeMillis(),
    )
    return board ? json({ ok: true, board }) : json({ ok: false, error: '比赛不存在。' }, 404)
  } catch (error) {
    console.error('[prediction] board unavailable', error)
    return json({ ok: false, error: '预测暂时无法读取。' }, 503)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const matchId = matchIdOf((await params).id)
  if (!matchId) return json({ ok: false, error: '比赛不存在。' }, 404)
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, ['teamId', 'stake'] as const)
    const accountId = await viewer(request)
    if (!accountId) return json({ ok: false, error: '登录后才能参与赛前预测。' }, 401)
    const db = cloudflareBindings().db
    const now = currentTimeMillis()
    const result = await placeMatchPrediction(
      db,
      { accountId, matchId, teamId: Number(fields.teamId), stake: Number(fields.stake) },
      now,
    )
    const board = await matchPredictionBoard(db, matchId, accountId, now)
    if (!result.ok) return json({ ok: false, error: FAILURES[result.reason], board }, 409)
    return json({ ok: true, board })
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return json({ ok: false, error: '请求无法确认，请刷新页面后重试。' }, 403)
    }
    console.error('[prediction] placement unavailable', error)
    return json({ ok: false, error: '预测暂时不可用，请稍后重试。' }, 503)
  }
}
