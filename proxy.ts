import { NextResponse, type NextRequest } from 'next/server'
import { issuerUrl, verifyToken } from '@/lib/jwt'

const SESSION_COOKIE = 'cs2cup_session'

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const login = request.nextUrl.clone()
  login.pathname = '/admin/login'

  if (!token || !issuerUrl()) return NextResponse.redirect(login)

  const claims = await verifyToken(token).catch(() => null)
  if (!claims) return NextResponse.redirect(login)

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin', '/admin/((?!login).*)'],
}
