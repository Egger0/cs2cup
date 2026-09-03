import 'server-only'

const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u

export const MEMBERSHIP_REVIEW_OVERDUE_MS = 24 * 60 * 60 * 1000
export const MEMBERSHIP_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000

export type MembershipApplicationStatus =
  | 'draft'
  | 'pending'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'withdrawn'

export type MembershipReviewDecision = 'approved' | 'changes_requested' | 'rejected'

export interface MembershipApplicationFields {
  readonly identityClaim?: string | null
  readonly contact?: string | null
  readonly applicationReason?: string | null
}

export interface NormalizedMembershipApplicationFields {
  readonly identityClaim: string | null
  readonly contact: string | null
  readonly applicationReason: string | null
}

export interface MembershipFieldIssue {
  readonly field: 'identityClaim' | 'contact' | 'applicationReason'
  readonly reason: 'invalid_type' | 'too_short' | 'too_long' | 'invalid_characters'
}

export type MembershipFieldsResult =
  | { readonly ok: true; readonly value: NormalizedMembershipApplicationFields }
  | ({ readonly ok: false } & MembershipFieldIssue)

function normalizeField(value: unknown, minimum: number, maximum: number, optional: boolean) {
  if (value === undefined || value === null || value === '') {
    return optional
      ? ({ ok: true, value: null } as const)
      : ({ ok: false, reason: 'too_short' } as const)
  }
  if (typeof value !== 'string') return { ok: false, reason: 'invalid_type' } as const
  const normalized = value.trim().normalize('NFC')
  const length = Array.from(normalized).length
  if (length < minimum) return { ok: false, reason: 'too_short' } as const
  if (length > maximum) return { ok: false, reason: 'too_long' } as const
  if (FORBIDDEN_TEXT.test(normalized)) return { ok: false, reason: 'invalid_characters' } as const
  return { ok: true, value: normalized } as const
}

export function normalizeMembershipApplicationFields(
  fields: MembershipApplicationFields,
): MembershipFieldsResult {
  const identityClaim = normalizeField(fields.identityClaim, 3, 160, true)
  if (!identityClaim.ok) return { ok: false, field: 'identityClaim', reason: identityClaim.reason }
  const contact = normalizeField(fields.contact, 3, 160, true)
  if (!contact.ok) return { ok: false, field: 'contact', reason: contact.reason }
  const applicationReason = normalizeField(fields.applicationReason, 1, 500, true)
  if (!applicationReason.ok) {
    return { ok: false, field: 'applicationReason', reason: applicationReason.reason }
  }
  return {
    ok: true,
    value: {
      identityClaim: identityClaim.value,
      contact: contact.value,
      applicationReason: applicationReason.value,
    },
  }
}

export function membershipFieldsAreSubmittable(fields: NormalizedMembershipApplicationFields) {
  return fields.identityClaim !== null && fields.contact !== null
}

export async function membershipSubmissionDigest(fields: NormalizedMembershipApplicationFields) {
  if (!membershipFieldsAreSubmittable(fields)) throw new TypeError('Membership draft is incomplete')
  const canonical = JSON.stringify({
    version: 1,
    identityClaim: fields.identityClaim,
    contact: fields.contact,
    applicationReason: fields.applicationReason,
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

interface ReviewClockApplication {
  readonly status: MembershipApplicationStatus
  readonly submittedAt: number | null
}

function validTime(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

export function isMembershipReviewOverdue(application: ReviewClockApplication, now: number) {
  return (
    (application.status === 'pending' || application.status === 'in_review') &&
    application.submittedAt !== null &&
    validTime(application.submittedAt) &&
    validTime(now) &&
    now >= application.submittedAt + MEMBERSHIP_REVIEW_OVERDUE_MS
  )
}

export function isMembershipReminderEligible(
  application: ReviewClockApplication,
  lastReminderAt: number | null,
  now: number,
) {
  return (
    isMembershipReviewOverdue(application, now) &&
    (lastReminderAt === null ||
      (validTime(lastReminderAt) && now >= lastReminderAt + MEMBERSHIP_REMINDER_COOLDOWN_MS))
  )
}

export function normalizeMembershipReviewReason(value: unknown) {
  return normalizeField(value, 3, 1000, false)
}
