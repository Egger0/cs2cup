import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const {
  MEMBERSHIP_REMINDER_COOLDOWN_MS,
  MEMBERSHIP_REVIEW_OVERDUE_MS,
  isMembershipReminderEligible,
  isMembershipReviewOverdue,
  membershipSubmissionDigest,
  normalizeMembershipApplicationFields,
  normalizeMembershipReviewReason,
} = await import('../lib/identity/internal/membership-policy.ts')

assert.deepEqual(normalizeMembershipApplicationFields({}), {
  ok: true,
  value: { identityClaim: null, contact: null, applicationReason: null },
})
assert.deepEqual(normalizeMembershipApplicationFields({ identityClaim: 'x' }), {
  ok: false,
  field: 'identityClaim',
  reason: 'too_short',
})
assert.deepEqual(normalizeMembershipApplicationFields({ contact: 'a\u202eb' }), {
  ok: false,
  field: 'contact',
  reason: 'invalid_characters',
})
const normalized = normalizeMembershipApplicationFields({
  identityClaim: '  NBT student 20260001  ',
  contact: ' player@example.test ',
  applicationReason: ' Join tournaments ',
})
assert.equal(normalized.ok, true)
if (!normalized.ok) throw new Error('Expected valid membership fields')
assert.equal(normalized.value.identityClaim, 'NBT student 20260001')
const digest = await membershipSubmissionDigest(normalized.value)
assert.match(digest, /^[0-9a-f]{64}$/)
assert.equal(await membershipSubmissionDigest(normalized.value), digest)
assert.notEqual(
  await membershipSubmissionDigest({ ...normalized.value, contact: 'other@example.test' }),
  digest,
)
await assert.rejects(
  membershipSubmissionDigest({ identityClaim: null, contact: null, applicationReason: null }),
  /incomplete/,
)
assert.equal(normalizeMembershipReviewReason(' yes ').ok, true)
assert.equal(normalizeMembershipReviewReason('x').ok, false)

const submittedAt = 1_000
const dueAt = submittedAt + MEMBERSHIP_REVIEW_OVERDUE_MS
const pending = { status: 'pending', submittedAt }
assert.equal(isMembershipReviewOverdue(pending, dueAt - 1), false)
assert.equal(isMembershipReviewOverdue(pending, dueAt), true)
assert.equal(isMembershipReviewOverdue({ status: 'changes_requested', submittedAt }, dueAt), false)
assert.equal(isMembershipReminderEligible(pending, null, dueAt), true)
assert.equal(isMembershipReminderEligible(pending, dueAt, dueAt + 1), false)
assert.equal(
  isMembershipReminderEligible(pending, dueAt, dueAt + MEMBERSHIP_REMINDER_COOLDOWN_MS),
  true,
)

console.log('identity membership policy tests passed')
