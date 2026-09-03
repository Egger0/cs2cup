import styles from './manager.module.css'

export interface ManagerFeedbackState {
  ok: boolean
  message: string
  scope: 'grant' | 'ledger'
}

export function ManagerFeedback({ feedback }: { feedback: ManagerFeedbackState }) {
  return (
    <p
      className={feedback.ok ? styles.success : styles.failure}
      role={feedback.ok ? 'status' : 'alert'}
      aria-live={feedback.ok ? 'polite' : 'assertive'}
    >
      {feedback.message}
    </p>
  )
}
