import { NextResponse } from 'next/server'
import { adminSessionCookie, createAdminSession, credentialsAccepted } from '@/lib/auth'

export async function POST(request: Request) {
  const form = await request.formData()
  const username = String(form.get('username') ?? '').trim()
  const password = String(form.get('password') ?? '')

  try {
    if (!await credentialsAccepted(username, password)) return NextResponse.redirect(new URL('/admin/login?error=1', request.url), 303)
    const response = NextResponse.redirect(new URL('/admin', request.url), 303)
    response.cookies.set(adminSessionCookie.name, await createAdminSession(username), {
      ...adminSessionCookie.options,
      maxAge: adminSessionCookie.maxAge,
    })
    return response
  } catch {
    return NextResponse.redirect(new URL('/admin/login?error=setup', request.url), 303)
  }
}
