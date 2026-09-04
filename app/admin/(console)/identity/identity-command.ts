'use client'

export async function postIdentityForm(endpoint: string, fields: Record<string, string>) {
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
  const payload = (await response.json().catch(() => null)) as {
    error?: string
    reauthenticate?: boolean
    redirectTo?: string
  } | null
  if (!response.ok) {
    if (payload?.reauthenticate && payload.redirectTo) window.location.assign(payload.redirectTo)
    throw new Error(payload?.error ?? '操作没有完成，请稍后重试。')
  }
}

export function membershipFields(values: Record<string, string>) {
  return {
    operation: '',
    applicationId: '',
    revision: '',
    submissionVersion: '',
    submissionDigest: '',
    decision: '',
    reasonCategory: '',
    reason: '',
    targetReviewerAccountId: '',
    transferId: '',
    membershipId: '',
    ...values,
  }
}
