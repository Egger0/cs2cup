const FORBIDDEN_DISPLAY_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u
const FORBIDDEN_MULTILINE_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u

export interface EnrollmentApplicationInput {
  readonly displayName: string
  readonly identityClaim: string
  readonly contact: string
  readonly reason: string | null
}

export type EnrollmentApplicationResult =
  | { ok: true; value: EnrollmentApplicationInput }
  | {
      ok: false
      field: 'displayName' | 'identityClaim' | 'contact' | 'reason'
      reason: 'required' | 'too_long' | 'invalid_characters'
    }

function normalized(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim().normalize('NFC') : ''
}

function singleLine(
  value: string,
  field: 'displayName' | 'identityClaim' | 'contact',
  min: number,
  max: number,
): EnrollmentApplicationResult | null {
  const length = Array.from(value).length
  if (length < min) return { ok: false, field, reason: 'required' }
  if (length > max) return { ok: false, field, reason: 'too_long' }
  if (FORBIDDEN_DISPLAY_CONTROLS.test(value)) {
    return { ok: false, field, reason: 'invalid_characters' }
  }
  return null
}

export function parseEnrollmentApplication(form: FormData): EnrollmentApplicationResult {
  const displayName = normalized(form.get('displayName'))
  const identityClaim = normalized(form.get('identityClaim'))
  const contact = normalized(form.get('contact'))
  const reasonValue = normalized(form.get('reason'))

  for (const issue of [
    singleLine(displayName, 'displayName', 1, 80),
    singleLine(identityClaim, 'identityClaim', 3, 160),
    singleLine(contact, 'contact', 3, 160),
  ]) {
    if (issue) return issue
  }
  if (Array.from(reasonValue).length > 500) {
    return { ok: false, field: 'reason', reason: 'too_long' }
  }
  if (FORBIDDEN_MULTILINE_CONTROLS.test(reasonValue)) {
    return { ok: false, field: 'reason', reason: 'invalid_characters' }
  }
  return {
    ok: true,
    value: { displayName, identityClaim, contact, reason: reasonValue || null },
  }
}
