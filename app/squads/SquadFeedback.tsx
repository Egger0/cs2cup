import styles from './squads.module.css'

export function SquadFeedback({ feedback }: { feedback: { ok: boolean; text: string } | null }) {
  if (!feedback) return null
  return (
    <p
      className={feedback.ok ? styles.success : styles.error}
      role={feedback.ok ? 'status' : 'alert'}
    >
      {feedback.text}
    </p>
  )
}
