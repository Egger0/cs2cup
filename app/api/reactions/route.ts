import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { withPrivateNoStore } from '@/lib/http-cache'
import { getAuthContext } from '@/lib/identity/kernel'
import { parseReactionSubject, summarizeReactions } from '@/lib/reactions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const subject = parseReactionSubject(params.get('kind'), params.get('id'))
  if (!subject) return withPrivateNoStore(NextResponse.json({ ok: false }, { status: 400 }))
  try {
    const database = cloudflareBindings().db
    const context = await getAuthContext({ database })
    const viewerId =
      context.kind === 'anonymous' || context.session.recoveryRestricted ? null : context.account.id
    const summary = await summarizeReactions(database, subject.kind, [subject.id], viewerId)
    return withPrivateNoStore(
      NextResponse.json({ ok: true, signedIn: Boolean(viewerId), ...summary[subject.id] }),
    )
  } catch {
    return withPrivateNoStore(NextResponse.json({ ok: false }, { status: 503 }))
  }
}
