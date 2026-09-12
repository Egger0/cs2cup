import type { ReactNode } from 'react'
import styles from './GhostStage.module.css'

export function GhostStage({
  figure,
  action,
  children,
}: {
  figure: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.stage}>
      {figure}
      <p className={styles.line}>{children}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
