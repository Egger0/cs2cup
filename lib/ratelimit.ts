import 'server-only'
import { randomBytes } from 'node:crypto'
import { headers } from 'next/headers'
import {
  fingerprintFromHeaders,
  MIN_FINGERPRINT_SECRET_BYTES,
  registrationClientIpHeader,
} from './ratelimit-fingerprint'

let developmentSecret: string | undefined

function fingerprintSecret() {
  const configured = process.env.REGISTRATION_FINGERPRINT_SECRET
  if (configured) return configured

  if (process.env.NODE_ENV !== 'development') return ''
  developmentSecret ??= randomBytes(MIN_FINGERPRINT_SECRET_BYTES).toString('base64url')
  return developmentSecret
}

export async function clientFingerprint() {
  const store = await headers()
  return fingerprintFromHeaders(store, {
    clientIpHeader: registrationClientIpHeader(
      process.env.REGISTRATION_CLIENT_IP_HEADER,
    ),
    secret: fingerprintSecret(),
    fallbackAddress: process.env.NODE_ENV === 'development' ? '127.0.0.1' : undefined,
  })
}
