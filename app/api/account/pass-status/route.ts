import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'
import { passCheckedIn } from '@/lib/pass-status'

export const dynamic = 'force-dynamic'

function json(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
}

export async function GET(request: NextRequest) {
  const teamId = Number(request.nextUrl.searchParams.get('teamId'))
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return json({ ok: false }, 400)
  try {
    const context = await getAuthContext({
      token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
    })
    if (context.kind !== 'authenticated' || context.session.recoveryRestricted)
      return json({ ok: false }, 401)
    const checkedIn = await passCheckedIn(cloudflareBindings().db, context.account.id, teamId)
    return checkedIn === null ? json({ ok: false }, 404) : json({ ok: true, checkedIn })
  } catch {
    return json({ ok: false }, 503)
  }
}
