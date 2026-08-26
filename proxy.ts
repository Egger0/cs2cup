import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE = 'cs2cup_session'

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/admin/login'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/admin', '/admin/((?!login).*)'],
}
