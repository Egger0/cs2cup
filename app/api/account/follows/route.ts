import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { currentTimeMillis } from '@/lib/current-time'
import {
  followTournaments,
  listFollowedTournamentIds,
  parseFollowIds,
  unfollowTournament,
} from '@/lib/follows'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'

export const dynamic = 'force-dynamic'

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
    if (!accountId) return json({ signedIn: false, ids: [] })
    return json({
      signedIn: true,
      ids: await listFollowedTournamentIds(cloudflareBindings().db, accountId),
    })
  } catch {
    return json({ signedIn: false, ids: [] })
  }
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const accountId = await viewer(request)
    if (!accountId) return json({ ok: false }, 401)
    const body = (await request.json().catch(() => null)) as {
      follow?: unknown
      unfollow?: unknown
    } | null
    const database = cloudflareBindings().db
    const follow = parseFollowIds(body?.follow ?? [])
    const unfollow = Number(body?.unfollow)
    if (!follow) return json({ ok: false }, 400)
    await followTournaments(database, accountId, follow, currentTimeMillis())
    if (Number.isSafeInteger(unfollow) && unfollow > 0) {
      await unfollowTournament(database, accountId, unfollow)
    }
    return json({ ok: true, ids: await listFollowedTournamentIds(database, accountId) })
  } catch (error) {
    if (error instanceof CsrfError) return json({ ok: false }, 403)
    return json({ ok: false }, 503)
  }
}
