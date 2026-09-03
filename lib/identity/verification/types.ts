export type VerificationPurpose = 'enrollment' | 'sign_in' | 'recovery' | 'identity_link'

export interface VerifiedExternalIdentity {
  adapterKind: 'cas' | 'oidc' | 'email_otp'
  provider: string
  issuer: string
  subject: string
  displayHint: string
  recoveryCapable: boolean
}

export type VerificationFailureCode =
  | 'invalid_configuration'
  | 'invalid_request'
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'invalid_provider_response'

export class VerificationAdapterError extends Error {
  readonly code: VerificationFailureCode

  constructor(code: VerificationFailureCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = 'VerificationAdapterError'
    this.code = code
  }
}
