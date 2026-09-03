import 'server-only'

import {
  normalizeRateLimitAddress,
  registrationClientIpSource,
} from '../../ratelimit-fingerprint.ts'
import { createAuthAttemptFingerprint, type AuthFingerprintKey } from './auth-fingerprint.ts'
import type { AuthAttemptCharge, AuthAttemptOperation } from './auth-attempts.ts'

interface AuthNetworkEnvironment {
  readonly NODE_ENV?: string
  readonly REGISTRATION_CLIENT_IP_SOURCE?: string
}

export async function networkAuthAttemptCharge(
  headers: Pick<Headers, 'get'>,
  operation: AuthAttemptOperation,
  key: AuthFingerprintKey,
  limit: number,
  environment: AuthNetworkEnvironment = process.env,
): Promise<AuthAttemptCharge> {
  const development = environment.NODE_ENV === 'development'
  const source = registrationClientIpSource(environment.REGISTRATION_CLIENT_IP_SOURCE, !development)
  const address = headers.get(source) ?? (development ? '127.0.0.1' : null)
  if (!address) throw new Error(`Trusted client IP header ${source} is missing`)
  return {
    dimension: 'network',
    ...(await createAuthAttemptFingerprint(
      key,
      operation,
      'network',
      normalizeRateLimitAddress(address),
    )),
    limit,
  }
}
