import { NextResponse, type NextRequest } from 'next/server'
import {
  CloudflareAccessError,
  verifyAccessRequest,
} from '@/lib/cloudflare-access'
import { assertCsrfRequest } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function denied() {
  return withPrivateNoStore(new NextResponse('forbidden', { status: 403 }))
}

function unavailable() {
  return withPrivateNoStore(
    new NextResponse('authentication service unavailable', { status: 503 }),
  )
}

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === '/photos' ||
    request.nextUrl.pathname.startsWith('/photos/')
  ) {
    return withPrivateNoStore(new NextResponse('not found', { status: 404 }))
  }

  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    try {
      assertCsrfRequest(request)
    } catch {
      return denied()
    }
  }

  try {
    if (!(await verifyAccessRequest(request.headers))) return denied()
  } catch (error) {
    if (error instanceof CloudflareAccessError) return unavailable()
    return unavailable()
  }

  return withPrivateNoStore(NextResponse.next())
}

export const config = {
  matcher: ['/photos/:path*', '/admin', '/admin/:path*'],
}
