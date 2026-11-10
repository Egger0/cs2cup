import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { currentTimeMillis } from '@/lib/current-time'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'
import { followedHandles, setPlayerFollow } from '@/lib/player-social'

export const dynamic = 'force-dynamic'

const REFUSAL = {
  not_found: '这位选手没有公开主页。',
  self: '不能关注自己。',
  limit: '最多关注 200 位选手。',
} as const

function json(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
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
  try {
    const accountId = await viewer(request)
    if (!accountId) return json({ signedIn: false, handles: [] })
    return json({
      signedIn: true,
      handles: await followedHandles(cloudflareBindings().db, accountId),
    })
  } catch {
    return json({ signedIn: false, handles: [] })
  }
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const accountId = await viewer(request)
    if (!accountId) return json({ ok: false, error: '登录后才能关注。' }, 401)
    const body = (await request.json().catch(() => null)) as {
      handle?: unknown
      follow?: unknown
    } | null
    if (typeof body?.handle !== 'string') return json({ ok: false, error: '请求无效。' }, 400)
    const database = cloudflareBindings().db
    const result = await setPlayerFollow(
      database,
      { followerId: accountId, handle: body.handle, follow: body.follow !== false },
      currentTimeMillis(),
    )
    if (!result.ok) return json({ ok: false, error: REFUSAL[result.reason] }, 400)
    return json({ ok: true, handles: await followedHandles(database, accountId) })
  } catch (error) {
    if (error instanceof CsrfError) return json({ ok: false, error: '请求无法确认。' }, 403)
    return json({ ok: false, error: '暂时无法保存。' }, 503)
  }
}
