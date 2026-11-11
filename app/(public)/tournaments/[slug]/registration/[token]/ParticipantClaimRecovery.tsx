import type { PasskeyClaimFeedback } from '@/lib/passkey-claim-recovery'

import styles from './claim-passkey.module.css'

export function ParticipantClaimRecovery({
  feedback,
  retryDelayLabel,
}: {
  feedback: PasskeyClaimFeedback
  retryDelayLabel: string | null
}) {
  const description =
    feedback.action === 'wait' && retryDelayLabel
      ? `${feedback.description} 本页会在${retryDelayLabel}后自动恢复操作。`
      : feedback.description

  return (
    <div className={styles.recovery} data-code={feedback.code}>
      <strong>{feedback.title}</strong>
      <p>{description}</p>
    </div>
  )
}
