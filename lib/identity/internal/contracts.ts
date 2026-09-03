import 'server-only'

export interface IdentityStatement {
  first<Result>(): Promise<Result | null>
  all<Result>(): Promise<{ results: Result[] }>
  run(): Promise<unknown>
}

export interface IdentityDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): IdentityStatement
  }
  batch(statements: IdentityStatement[]): Promise<unknown[]>
}

export type IdentityAuthMethod =
  | 'passkey'
  | 'password'
  | 'oidc'
  | 'cas'
  | 'email_otp'
  | 'recovery_code'
  | 'assisted_recovery'
  | 'bootstrap'

export type VerificationState = 'legacy_unverified' | 'verified'

export interface AuthenticatedAuthContext {
  readonly kind: 'authenticated'
  readonly account: {
    readonly id: string
    readonly displayName: string
    readonly verificationState: VerificationState
  }
  readonly session: {
    readonly id: string
    readonly authMethod: IdentityAuthMethod
    readonly createdAt: number
    readonly lastSeenAt: number
    readonly idleExpiresAt: number
    readonly absoluteExpiresAt: number
    readonly authenticatedAt: number
    readonly phishingResistantAt: number | null
    readonly recoveryVerifiedAt: number | null
    readonly recoveryRestricted: boolean
  }
}

export interface AnonymousAuthContext {
  readonly kind: 'anonymous'
}

export type AuthContext = AuthenticatedAuthContext | AnonymousAuthContext

export type SessionAuthentication =
  | { method: 'passkey'; authenticatorCredentialId: string; authIntentId: string }
  | { method: 'password'; passwordCredentialId: string; verificationNonce: string }
  | {
      method: 'oidc' | 'cas' | 'email_otp'
      recovery: { authIntentId: string }
    }
  | {
      method: 'recovery_code'
      recovery: { authIntentId: string; recoveryCodeId: string }
    }
  | {
      /** Requires a consumed, approved assisted-recovery authorization in the database. */
      method: 'assisted_recovery'
      recovery: { authIntentId: string }
    }

export interface CreateSessionDraftInput {
  accountId: string
  authentication: SessionAuthentication
  displayMetadata?: Readonly<Record<string, string | number | boolean | null>>
  now?: number
}

export interface SessionDraft {
  readonly token: string
  readonly record: {
    readonly id: string
    readonly tokenHash: string
    readonly accountId: string
    readonly authMethod: IdentityAuthMethod
    readonly authenticatorCredentialId: string | null
    readonly passwordCredentialId: string | null
    readonly passwordVerificationNonce: string | null
    readonly passkeyAuthIntentId: string | null
    readonly recoveryCodeId: string | null
    readonly recoveryAuthIntentId: string | null
    readonly createdAt: number
    readonly lastSeenAt: number
    readonly idleExpiresAt: number
    readonly absoluteExpiresAt: number
    readonly authenticatedAt: number
    readonly phishingResistantAt: number | null
    readonly recoveryVerifiedAt: number | null
    readonly recoveryRestricted: boolean
    readonly displayMetadataJson: string
  }
}

export interface IdentityKernelDependencies {
  database?: IdentityDatabase
  now?: number
}

export const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/
export const PASSKEY_CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,1366}$/

export function validTimestamp(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

export function validPositiveId(value: number) {
  return Number.isSafeInteger(value) && value > 0
}
