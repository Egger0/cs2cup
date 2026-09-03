import { NextResponse } from 'next/server'
import {
  AdminLoginRequestError,
  assertAdminLoginRequestHeaders,
  readAdminLoginRequest,
} from '@/lib/admin-login-request'
import { adminSessionCookie, createAdminSession, credentialsAccepted } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import {
  AdminLoginAttemptError,
  admitAdminLoginAttempt,
  retryAfterSeconds,
} from '@/lib/queries/admin-login-attempts'
import { clientFingerprint } from '@/lib/ratelimit'
import { resolveSiteOrigin } from '@/lib/site-config'

export async function POST(request: Request) {
  try {
    assertCsrfRequest(request)
  } catch (error) {
    if (error instanceof CsrfError) {
      return withPrivateNoStore(new NextResponse('Forbidden', { status: 403 }))
    }
    throw error
  }

  const redirectTo = (path: string) =>
    withPrivateNoStore(NextResponse.redirect(new URL(path, resolveSiteOrigin()), 303))
  const now = Date.now()

  try {
    assertAdminLoginRequestHeaders(request)
    const fingerprint = await clientFingerprint('admin-login')
    const db = cloudflareBindings().db
    const admission = await admitAdminLoginAttempt(db, { fingerprint, now })
    const { username, password } = await readAdminLoginRequest(request)
    if (!(await credentialsAccepted(username, password))) return redirectTo('/admin/login?error=1')
    const response = redirectTo('/admin')
    response.cookies.set(adminSessionCookie.name, await createAdminSession(username, admission), {
      ...adminSessionCookie.options,
      maxAge: adminSessionCookie.maxAge,
    })
    return response
  } catch (error) {
    if (error instanceof AdminLoginRequestError) return redirectTo('/admin/login?error=1')
    if (error instanceof AdminLoginAttemptError) {
      const response = redirectTo('/admin/login?error=rate')
      response.headers.set('Retry-After', String(retryAfterSeconds(now)))
      return response
    }
    return redirectTo('/admin/login?error=setup')
  }
}
