import { NextResponse, type NextRequest } from 'next/server'
import { verifyToken } from '@/lib/jwt'

const SESSION_COOKIE = 'cs2cup_session'

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === '/photos' ||
    request.nextUrl.pathname.startsWith('/photos/')
  ) {
    return new NextResponse('not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const login = request.nextUrl.clone()
  login.pathname = '/admin/login'

  if (!token) return NextResponse.redirect(login)
  const claims = await verifyToken(token).catch(() => null)
  if (!claims) {
    const response = NextResponse.redirect(login)
    response.cookies.delete(SESSION_COOKIE)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/photos/:path*', '/admin', '/admin/((?!login).*)'],
}
