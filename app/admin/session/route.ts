import { NextResponse } from 'next/server'
import { authenticateAdminCredentials } from '@/lib/auth'
import { adminSessionCookie } from '@/lib/admin-session-cookie'
import { assertCsrfRequest } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'

const MAXIMUM_LOGIN_BODY_BYTES = 4 * 1_024

class LoginRequestError extends Error {
  constructor(readonly status: 400 | 413 | 415) {
    super('Invalid administrator login request')
    this.name = 'LoginRequestError'
  }
}

async function loginFields(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.split(';', 1)[0]?.trim() !== 'application/x-www-form-urlencoded') {
    throw new LoginRequestError(415)
  }

  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAXIMUM_LOGIN_BODY_BYTES) {
        await reader.cancel()
        throw new LoginRequestError(413)
      }
      chunks.push(value)
    }
  }

  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const fields = new URLSearchParams(new TextDecoder().decode(body))
  const usernames = fields.getAll('username')
  const passwords = fields.getAll('password')
  if (usernames.length !== 1 || passwords.length !== 1) {
    throw new LoginRequestError(400)
  }
  return { username: usernames[0] ?? '', password: passwords[0] ?? '' }
}

function loginRedirect(request: Request, error?: 'invalid' | 'rate' | 'unavailable') {
  const target = new URL('/admin/login', request.url)
  if (error) target.searchParams.set('error', error)
  return withPrivateNoStore(NextResponse.redirect(target, 303))
}

export async function POST(request: Request) {
  try {
    assertCsrfRequest(request)
  } catch {
    return withPrivateNoStore(new NextResponse('forbidden', { status: 403 }))
  }

  let fields: Awaited<ReturnType<typeof loginFields>>
  try {
    fields = await loginFields(request)
  } catch (error) {
    const status = error instanceof LoginRequestError ? error.status : 400
    return withPrivateNoStore(new NextResponse('invalid login request', { status }))
  }

  try {
    const result = await authenticateAdminCredentials(
      fields.username,
      fields.password,
      request.headers,
    )

    if (result.kind === 'invalid') return loginRedirect(request, 'invalid')
    if (result.kind === 'rate_limited') {
      const response = loginRedirect(request, 'rate')
      response.headers.set('Retry-After', String(result.retryAfterSeconds))
      return response
    }

    const response = withPrivateNoStore(
      NextResponse.redirect(new URL('/admin', request.url), 303),
    )
    response.cookies.set(adminSessionCookie.name, result.token, {
      ...adminSessionCookie.options(),
      maxAge: adminSessionCookie.maxAge,
    })
    return response
  } catch (error) {
    console.error('[admin-auth] login unavailable', error)
    return loginRedirect(request, 'unavailable')
  }
}
