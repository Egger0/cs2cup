const MAX_BODY_BYTES = 4 * 1024
export const MAX_ADMIN_USERNAME_LENGTH = 128
export const MAX_ADMIN_PASSWORD_LENGTH = 1024

export class AdminLoginRequestError extends Error {
  constructor() {
    super('Invalid administrator login request')
    this.name = 'AdminLoginRequestError'
  }
}

export function assertAdminLoginRequestHeaders(request: Request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/x-www-form-urlencoded') {
    throw new AdminLoginRequestError()
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES) {
      throw new AdminLoginRequestError()
    }
  }
}

async function readBoundedBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new AdminLoginRequestError()

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      try {
        await reader.cancel()
      } catch {
        // The request is rejected even when its stream cannot be cancelled.
      }
      throw new AdminLoginRequestError()
    }
    chunks.push(value)
  }
  if (total === 0) throw new AdminLoginRequestError()

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readAdminLoginRequest(request: Request) {
  assertAdminLoginRequestHeaders(request)

  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBody(request))
    const form = new URLSearchParams(source)
    if ([...form.keys()].some(key => key !== 'username' && key !== 'password')) {
      throw new AdminLoginRequestError()
    }
    const usernames = form.getAll('username')
    const passwords = form.getAll('password')
    if (usernames.length !== 1 || passwords.length !== 1) throw new AdminLoginRequestError()

    const username = usernames[0]?.trim() ?? ''
    const password = passwords[0] ?? ''
    const encoder = new TextEncoder()
    const usernameBytes = encoder.encode(username).byteLength
    const passwordBytes = encoder.encode(password).byteLength
    if (
      usernameBytes === 0 ||
      usernameBytes > MAX_ADMIN_USERNAME_LENGTH ||
      passwordBytes === 0 ||
      passwordBytes > MAX_ADMIN_PASSWORD_LENGTH
    ) {
      throw new AdminLoginRequestError()
    }
    return { username, password }
  } catch (error) {
    if (error instanceof AdminLoginRequestError) throw error
    throw new AdminLoginRequestError()
  }
}
