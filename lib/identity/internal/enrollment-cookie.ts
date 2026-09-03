import 'server-only'

import { cookies } from 'next/headers'
import { isOpaqueToken } from '../../opaque-token.ts'

export const ENROLLMENT_RECEIPT_COOKIE = '__Host-cs2cup_enrollment_receipt'
export const ENROLLMENT_BROWSER_COOKIE = '__Host-cs2cup_enrollment_browser'
export const ENROLLMENT_ACTIVATION_COOKIE = '__Host-cs2cup_enrollment_activation'
export const ENROLLMENT_APPLICATION_MAX_AGE = 30 * 24 * 60 * 60
export const ENROLLMENT_ACTIVATION_MAX_AGE = 30 * 60

interface EnrollmentCookieOptions {
  readonly httpOnly: true
  readonly path: '/'
  readonly sameSite: 'lax'
  readonly secure: true
}

const options: EnrollmentCookieOptions = Object.freeze({
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
})

interface CookieResponse {
  cookies: {
    set(
      name: string,
      value: string,
      cookieOptions: EnrollmentCookieOptions & { readonly maxAge: number },
    ): unknown
  }
}

export interface EnrollmentProof {
  readonly receipt: string
  readonly browserBinding: string
}

export async function readEnrollmentProof(): Promise<EnrollmentProof | null> {
  const store = await cookies()
  const receipt = store.get(ENROLLMENT_RECEIPT_COOKIE)?.value ?? ''
  const browserBinding = store.get(ENROLLMENT_BROWSER_COOKIE)?.value ?? ''
  return isOpaqueToken(receipt) && isOpaqueToken(browserBinding)
    ? { receipt, browserBinding }
    : null
}

export async function readEnrollmentActivationToken() {
  const token = (await cookies()).get(ENROLLMENT_ACTIVATION_COOKIE)?.value ?? ''
  return isOpaqueToken(token) ? token : null
}

export function setEnrollmentProofCookies(response: CookieResponse, proof: EnrollmentProof) {
  if (!isOpaqueToken(proof.receipt) || !isOpaqueToken(proof.browserBinding)) {
    throw new TypeError('Invalid enrollment browser proof')
  }
  response.cookies.set(ENROLLMENT_RECEIPT_COOKIE, proof.receipt, {
    ...options,
    maxAge: ENROLLMENT_APPLICATION_MAX_AGE,
  })
  response.cookies.set(ENROLLMENT_BROWSER_COOKIE, proof.browserBinding, {
    ...options,
    maxAge: ENROLLMENT_APPLICATION_MAX_AGE,
  })
  return response
}

export function setEnrollmentActivationCookie(response: CookieResponse, token: string) {
  if (!isOpaqueToken(token)) throw new TypeError('Invalid enrollment activation token')
  response.cookies.set(ENROLLMENT_ACTIVATION_COOKIE, token, {
    ...options,
    maxAge: ENROLLMENT_ACTIVATION_MAX_AGE,
  })
  return response
}

export function clearEnrollmentCookies(response: CookieResponse) {
  for (const name of [
    ENROLLMENT_RECEIPT_COOKIE,
    ENROLLMENT_BROWSER_COOKIE,
    ENROLLMENT_ACTIVATION_COOKIE,
  ]) {
    response.cookies.set(name, '', { ...options, maxAge: 0 })
  }
  return response
}
