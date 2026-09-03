import { evaluatePasswordPolicy } from './password-policy.ts'
import { containsPasswordContext } from './password-screening.ts'
import { evaluateUsernamePolicy } from './username-policy.ts'

const FORBIDDEN_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u

export interface SelfRegistrationFields {
  readonly username: string
  readonly displayName: string
  readonly password: string
  readonly passwordConfirmation: string
}

export interface SelfRegistrationInput {
  readonly username: string
  readonly displayName: string
  readonly normalizedPassword: string
}

export type SelfRegistrationFailure =
  | { readonly field: 'username'; readonly reason: 'invalid_format' | 'reserved' }
  | {
      readonly field: 'displayName'
      readonly reason: 'required' | 'too_long' | 'invalid_characters'
    }
  | {
      readonly field: 'password'
      readonly reason: 'too_short' | 'too_long' | 'invalid_unicode' | 'contains_account_context'
    }
  | { readonly field: 'passwordConfirmation'; readonly reason: 'mismatch' }

export type SelfRegistrationPolicyResult =
  | { readonly ok: true; readonly value: SelfRegistrationInput }
  | { readonly ok: false; readonly issue: SelfRegistrationFailure }

function displayNamePolicy(value: unknown) {
  if (typeof value !== 'string') return { ok: false, reason: 'required' } as const
  const displayName = value.trim().normalize('NFC')
  const length = Array.from(displayName).length
  if (!length) return { ok: false, reason: 'required' } as const
  if (length > 80) return { ok: false, reason: 'too_long' } as const
  if (FORBIDDEN_DISPLAY_CHARACTERS.test(displayName)) {
    return { ok: false, reason: 'invalid_characters' } as const
  }
  return { ok: true, displayName } as const
}

export function evaluateSelfRegistration(
  fields: SelfRegistrationFields,
): SelfRegistrationPolicyResult {
  const username = evaluateUsernamePolicy(fields.username)
  if (!username.ok) {
    return {
      ok: false,
      issue: {
        field: 'username',
        reason: username.reason === 'reserved' ? 'reserved' : 'invalid_format',
      },
    }
  }
  const displayName = displayNamePolicy(fields.displayName)
  if (!displayName.ok) {
    return {
      ok: false,
      issue: { field: 'displayName', reason: displayName.reason },
    }
  }
  const password = evaluatePasswordPolicy(fields.password)
  if (!password.ok) {
    return {
      ok: false,
      issue: {
        field: 'password',
        reason: password.reason === 'invalid_type' ? 'invalid_unicode' : password.reason,
      },
    }
  }
  if (password.normalizedPassword !== fields.passwordConfirmation.normalize('NFC')) {
    return { ok: false, issue: { field: 'passwordConfirmation', reason: 'mismatch' } }
  }
  if (
    containsPasswordContext(password.normalizedPassword, [
      username.username,
      displayName.displayName,
      'cs2cup',
      '宁波理工电竞社',
    ])
  ) {
    return {
      ok: false,
      issue: { field: 'password', reason: 'contains_account_context' },
    }
  }
  return {
    ok: true,
    value: {
      username: username.username,
      displayName: displayName.displayName,
      normalizedPassword: password.normalizedPassword,
    },
  }
}
