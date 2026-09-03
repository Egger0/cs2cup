const MIN_PASSWORD_CODE_POINTS = 15
const MAX_PASSWORD_CODE_POINTS = 128
const MAX_PASSWORD_UTF8_BYTES = 1024

export type PasswordPolicyFailure = 'invalid_type' | 'too_short' | 'too_long' | 'invalid_unicode'

export type PasswordPolicyResult =
  | { ok: true; normalizedPassword: string }
  | { ok: false; reason: PasswordPolicyFailure }

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true
    }
  }
  return false
}

/**
 * NIST-style password policy: length and compromised-value screening, not composition rules.
 * Breached/context-specific password screening is deliberately performed by the server adapter.
 */
export function evaluatePasswordPolicy(value: unknown): PasswordPolicyResult {
  if (typeof value !== 'string') return { ok: false, reason: 'invalid_type' }
  if (hasUnpairedSurrogate(value)) return { ok: false, reason: 'invalid_unicode' }

  const normalizedPassword = value.normalize('NFC')
  const codePoints = Array.from(normalizedPassword).length
  if (codePoints < MIN_PASSWORD_CODE_POINTS) return { ok: false, reason: 'too_short' }
  if (
    codePoints > MAX_PASSWORD_CODE_POINTS ||
    new TextEncoder().encode(normalizedPassword).byteLength > MAX_PASSWORD_UTF8_BYTES
  ) {
    return { ok: false, reason: 'too_long' }
  }
  return { ok: true, normalizedPassword }
}

export const PASSWORD_POLICY = Object.freeze({
  minCodePoints: MIN_PASSWORD_CODE_POINTS,
  maxCodePoints: MAX_PASSWORD_CODE_POINTS,
  maxUtf8Bytes: MAX_PASSWORD_UTF8_BYTES,
})
