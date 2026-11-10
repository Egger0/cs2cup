import { NextResponse, type NextRequest } from 'next/server'

import { getCurrentUnifiedPlatformOwner } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { listComments, parseCommentSubject } from '@/lib/comments'
import { withPrivateNoStore } from '@/lib/http-cache'
import { getAuthContext } from '@/lib/identity/kernel'
import { summarizeReactions } from '@/lib/reactions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const subject = parseCommentSubject(params.get('kind'), params.get('id'))
  if (!subject) return withPrivateNoStore(NextResponse.json({ ok: false }, { status: 400 }))
  try {
    const database = cloudflareBindings().db
    const context = await getAuthContext({ database })
    const viewerId =
      context.kind === 'anonymous' || context.session.recoveryRestricted ? null : context.account.id
    const moderator = viewerId
      ? Boolean(await getCurrentUnifiedPlatformOwner().catch(() => null))
      : false
    const comments = await listComments(database, subject, moderator)
    const [subjectReactions, commentReactions] = await Promise.all([
      summarizeReactions(database, subject.kind, [subject.id], viewerId),
      summarizeReactions(
        database,
        'comment',
        comments.map(comment => comment.id),
        viewerId,
      ),
    ])
    return withPrivateNoStore(
      NextResponse.json({
        ok: true,
        viewerId,
        moderator,
        comments,
        reactions: subjectReactions[subject.id],
        commentReactions,
      }),
    )
  } catch {
    return withPrivateNoStore(NextResponse.json({ ok: false }, { status: 503 }))
  }
}
