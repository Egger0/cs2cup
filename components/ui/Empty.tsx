import type { ReactNode } from 'react'
import styles from './Empty.module.css'

export function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>
}
