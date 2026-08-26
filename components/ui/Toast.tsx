import styles from './Toast.module.css'

export interface ToastProps {
  open: boolean
  title: string
  message?: string
}

export function Toast({ open, title, message }: ToastProps) {
  return (
    <div
      className={open ? `${styles.toast} ${styles.open}` : styles.toast}
      role="status"
      aria-live="polite"
    >
      <span className={styles.title}>{title}</span>
      {message ? <span className={styles.message}>{message}</span> : null}
    </div>
  )
}
