import type { ReactNode } from 'react'
import { SectionTabs } from '@/components/layout/SectionTabs'
import styles from './archive.module.css'

const TABS = [
  { href: '/archive', label: '往届存档', exact: true },
  { href: '/archive/merit', label: '功德榜' },
]

export function ArchiveSheet({ children }: { children: ReactNode }) {
  return (
    <div className={styles.sheet}>
      <SectionTabs tabs={TABS} label="往届导航" />
      {children}
    </div>
  )
}
