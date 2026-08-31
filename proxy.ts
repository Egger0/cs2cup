import { NextResponse, type NextRequest } from 'next/server'
import { withPrivateNoStore } from '@/lib/http-cache'
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/photos' || request.nextUrl.pathname.startsWith('/photos/')) {
    return withPrivateNoStore(new NextResponse('not found', { status: 404 }))
  }

  // D1-backed authorization runs in the admin server layout. Keep this proxy
  // limited to the route that is intentionally retired so it stays Edge-safe.
  return NextResponse.next()
}

export const config = {
  matcher: ['/photos/:path*', '/admin', '/admin/((?!login).*)'],
}
