import type {
  MembershipQueueReviewer,
  MembershipReviewQueueItem,
} from '@/lib/identity/membership-service'
import { ReviewCard } from './ReviewCard'
import styles from './identity.module.css'

export function ReviewQueue({
  applications,
  reviewers,
  currentAccountId,
  now,
}: {
  applications: readonly MembershipReviewQueueItem[]
  reviewers: readonly MembershipQueueReviewer[]
  currentAccountId: string
  now: number
}) {
  if (!applications.length) {
    return <p className={styles.empty}>当前页没有待处理的成员资格申请。</p>
  }
  return (
    <div className={styles.queue}>
      {applications.map(application => (
        <ReviewCard
          key={application.id}
          application={application}
          reviewers={reviewers}
          currentAccountId={currentAccountId}
          now={now}
        />
      ))}
    </div>
  )
}
