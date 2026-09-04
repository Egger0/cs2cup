import 'server-only'

import type { IdentityDatabase } from './internal/contracts.ts'

export interface MembershipReviewHistoryItem {
  readonly id: string
  readonly reviewerDisplayName: string
  readonly decision: 'approved' | 'changes_requested' | 'rejected'
  readonly reasonCategory: string
  readonly reason: string
  readonly decidedAt: number
}

export interface MembershipReviewTransfer {
  readonly id: string
  readonly fromReviewerDisplayName: string
  readonly toReviewerAccountId: string
  readonly toReviewerDisplayName: string
  readonly reason: string
  readonly createdAt: number
  readonly active: boolean
}

interface HistoryRow {
  id: string
  application_id: string
  display_name: string
  decision: MembershipReviewHistoryItem['decision']
  reason_category: string
  reason: string
  decided_at: number
}

interface TransferRow {
  id: string
  application_id: string
  source_name: string
  to_reviewer_account_id: string
  target_name: string
  reason: string
  created_at: number
  active: number
}

export async function membershipReviewDetails(
  database: IdentityDatabase,
  applicationIds: readonly string[],
) {
  const histories = new Map<string, MembershipReviewHistoryItem[]>()
  const transfers = new Map<string, MembershipReviewTransfer[]>()
  if (!applicationIds.length) return { histories, transfers }
  const placeholders = applicationIds.map(() => '?').join(', ')
  const [reviews, transferRecords] = await Promise.all([
    database
      .prepare(
        `SELECT review.id, review.application_id, reviewer.display_name,
                review.decision, review.reason_category, review.reason, review.decided_at
         FROM identity_membership_review AS review
         JOIN identity_account AS reviewer ON reviewer.id = review.reviewer_account_id
         WHERE review.application_id IN (${placeholders})
         ORDER BY review.decided_at DESC, review.id LIMIT 500`,
      )
      .bind(...applicationIds)
      .all<HistoryRow>(),
    database
      .prepare(
        `SELECT transfer.id, transfer.application_id, source.display_name AS source_name,
                transfer.to_reviewer_account_id, target.display_name AS target_name,
                transfer.reason, transfer.created_at,
                CASE WHEN application.status = 'in_review'
                  AND application.assigned_reviewer_account_id = transfer.from_reviewer_account_id
                  AND transfer.created_at >= application.review_started_at THEN 1 ELSE 0 END AS active
         FROM identity_membership_review_transfer AS transfer
         JOIN identity_membership_application AS application
           ON application.id = transfer.application_id
         JOIN identity_account AS source ON source.id = transfer.from_reviewer_account_id
         JOIN identity_account AS target ON target.id = transfer.to_reviewer_account_id
         WHERE transfer.application_id IN (${placeholders})
         ORDER BY transfer.created_at DESC, transfer.id LIMIT 500`,
      )
      .bind(...applicationIds)
      .all<TransferRow>(),
  ])
  for (const row of reviews.results) {
    const items = histories.get(row.application_id) ?? []
    items.push({
      id: row.id,
      reviewerDisplayName: row.display_name,
      decision: row.decision,
      reasonCategory: row.reason_category,
      reason: row.reason,
      decidedAt: row.decided_at,
    })
    histories.set(row.application_id, items)
  }
  for (const row of transferRecords.results) {
    const items = transfers.get(row.application_id) ?? []
    items.push({
      id: row.id,
      fromReviewerDisplayName: row.source_name,
      toReviewerAccountId: row.to_reviewer_account_id,
      toReviewerDisplayName: row.target_name,
      reason: row.reason,
      createdAt: row.created_at,
      active: row.active === 1,
    })
    transfers.set(row.application_id, items)
  }
  return { histories, transfers }
}
