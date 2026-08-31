import 'server-only'

import { resolveSiteOrigin } from './site-config.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

interface CsrfEnvironment {
  [name: string]: string | undefined
  NEXT_PUBLIC_SITE_URL?: string
}

interface CsrfRequestLike {
  method: string
  headers: Headers
}

export class CsrfError extends Error {
  constructor() {
    super('Request origin could not be verified')
    this.name = 'CsrfError'
  }
}

function configuredOrigin(environment: CsrfEnvironment) {
  const configured = environment.NEXT_PUBLIC_SITE_URL
  if (!configured || configured !== configured.trim()) throw new CsrfError()
  try {
    return resolveSiteOrigin(configured)
  } catch {
    throw new CsrfError()
  }
}

function exactHeaderOrigin(value: string | null) {
  if (!value || value === 'null' || value !== value.trim()) return null
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    if (url.origin !== value) return null
    return url.origin
  } catch {
    return null
  }
}

function exactRefererOrigin(value: string | null) {
  if (!value || value !== value.trim()) return null
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export function csrfRequestAllowed(
  request: CsrfRequestLike,
  environment: CsrfEnvironment = process.env,
) {
  const method = request.method.toUpperCase()
  if (SAFE_METHODS.has(method)) return true

  const expected = configuredOrigin(environment)
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return false

  const originHeader = request.headers.get('origin')
  if (originHeader !== null) {
    return exactHeaderOrigin(originHeader) === expected
  }

  // Non-browser and older clients may omit Fetch Metadata and Origin. A full
  // same-origin Referer is the only accepted fallback; Host and forwarded-host
  // headers are intentionally not authority sources.
  const referer = exactRefererOrigin(request.headers.get('referer'))
  return referer === expected
}

export function assertCsrfRequest(
  request: CsrfRequestLike,
  environment: CsrfEnvironment = process.env,
) {
  if (!csrfRequestAllowed(request, environment)) throw new CsrfError()
}
