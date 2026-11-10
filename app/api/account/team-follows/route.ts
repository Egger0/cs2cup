import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { currentTimeMillis } from '@/lib/current-time'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'
import { setTeamFollow, teamFollowState } from '@/lib/team-follows'

export const dynamic = 'force-dynamic'

function json(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
}

function teamIdOf(raw: unknown) {
  const id = Number(raw)
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

export async function GET(request: NextRequest) {
  const teamId = teamIdOf(request.nextUrl.searchParams.get('teamId'))
  if (!teamId) return json({ ok: false }, 400)
  try {
    const accountId = await viewer(request)
    const state = await teamFollowState(cloudflareBindings().db, teamId, accountId)
    return json({ ok: true, signedIn: Boolean(accountId), ...state })
  } catch {
    return json({ ok: false }, 503)
  }
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const accountId = await viewer(request)
    if (!accountId) return json({ ok: false, error: '登录后才能关注。' }, 401)
    const body = (await request.json().catch(() => null)) as {
      teamId?: unknown
      follow?: unknown
    } | null
    const teamId = teamIdOf(body?.teamId)
    if (!teamId) return json({ ok: false, error: '请求无效。' }, 400)
    const saved = await setTeamFollow(
      cloudflareBindings().db,
      { accountId, teamId, follow: body?.follow !== false },
      currentTimeMillis(),
    )
    return saved
      ? json({ ok: true })
      : json({ ok: false, error: '这支队伍暂时不能关注，或已关注 200 支队伍。' }, 400)
  } catch (error) {
    if (error instanceof CsrfError) return json({ ok: false, error: '请求无法确认。' }, 403)
    return json({ ok: false, error: '暂时无法保存。' }, 503)
  }
}
