import { NextResponse, type NextRequest } from 'next/server'
import { assertCsrfRequest } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function denied() {
  return withPrivateNoStore(new NextResponse('forbidden', { status: 403 }))
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

  return withPrivateNoStore(NextResponse.next())
}

export const config = {
  matcher: [
    '/photos/:path*',
    '/admin',
    '/admin/:path*',
    {
      source: '/:path*',
      has: [{ type: 'header', key: 'next-action' }],
    },
  ],
}
