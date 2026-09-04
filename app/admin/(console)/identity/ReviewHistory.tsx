import { formatSiteNumericDateTime } from '@/lib/datetime'
import type { MembershipReviewQueueItem } from '@/lib/identity/membership-service'
import styles from './operations.module.css'

const DECISION_LABEL = {
  approved: '通过并授予成员资格',
  changes_requested: '请申请者补充资料',
  rejected: '拒绝本次申请',
}

const REASON_LABEL: Readonly<Record<string, string>> = {
  eligible: '资格符合',
  insufficient_evidence: '证明材料不足',
  not_eligible: '暂不符合资格',
  duplicate: '重复申请',
  other: '其他',
}

export function ReviewHistory({ application }: { application: MembershipReviewQueueItem }) {
  if (!application.history.length && !application.transfers.length) return null
  return (
    <details className={styles.history}>
      <summary>审核轨迹 · {application.history.length + application.transfers.length} 条</summary>
      <ol>
        {application.history.map(item => (
          <li key={item.id}>
            <time>{formatSiteNumericDateTime(item.decidedAt)}</time>
            <strong>
              {item.reviewerDisplayName} · {DECISION_LABEL[item.decision]}
            </strong>
            <span>
              {REASON_LABEL[item.reasonCategory] ?? '其他'} · {item.reason}
            </span>
          </li>
        ))}
        {application.transfers.map(item => (
          <li key={item.id}>
            <time>{formatSiteNumericDateTime(item.createdAt)}</time>
            <strong>
              {item.fromReviewerDisplayName} → {item.toReviewerDisplayName}
            </strong>
            <span>{item.reason}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}
