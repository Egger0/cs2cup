import { NextResponse } from 'next/server'
import { adminSessionCookie, createAdminSession, credentialsAccepted } from '@/lib/auth'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { resolveSiteOrigin } from '@/lib/site-config'

export async function POST(request: Request) {
  try {
    assertCsrfRequest(request)
  } catch (error) {
    if (error instanceof CsrfError) {
      return new NextResponse('Forbidden', { status: 403 })
    }
    throw error
  }

  const form = await request.formData()
  const username = String(form.get('username') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, resolveSiteOrigin()), 303)

  try {
    if (!(await credentialsAccepted(username, password))) return redirectTo('/admin/login?error=1')
    const response = redirectTo('/admin')
    response.cookies.set(adminSessionCookie.name, await createAdminSession(username), {
      ...adminSessionCookie.options,
      maxAge: adminSessionCookie.maxAge,
    })
    return response
  } catch {
    return redirectTo('/admin/login?error=setup')
  }
}
