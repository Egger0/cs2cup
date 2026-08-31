import type { ReactNode } from 'react'
import styles from './Empty.module.css'

interface EmptyProps {
  children: ReactNode
  action?: ReactNode
}

export function Empty({ children, action }: EmptyProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.line}>{children}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
