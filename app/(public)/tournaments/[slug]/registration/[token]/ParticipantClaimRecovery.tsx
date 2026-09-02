import type { PasskeyClaimFeedback } from '@/lib/passkey-claim-recovery'

import styles from './claim-passkey.module.css'

const RECOVERY_SIGNAL: Record<PasskeyClaimFeedback['code'], string> = {
  'receipt-refresh-required': 'RECEIPT / REFRESH',
  'rate-limited': 'PACE / HOLD',
  'verification-failed': 'PASS / NOT CREATED',
  'verification-uncertain': 'RESULT / UNKNOWN',
  'interrupted-or-unavailable': 'DEVICE / INTERRUPTED',
  'temporarily-unavailable': 'SERVICE / STANDBY',
}

export function ParticipantClaimRecovery({ feedback }: { feedback: PasskeyClaimFeedback }) {
  return (
    <div className={styles.recovery} data-code={feedback.code}>
      <span className={styles.recoverySignal} aria-hidden="true">
        {RECOVERY_SIGNAL[feedback.code]}
      </span>
      <strong>{feedback.title}</strong>
      <p>{feedback.description}</p>
    </div>
  )
}
