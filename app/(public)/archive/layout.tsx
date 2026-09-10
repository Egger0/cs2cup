import type { ReactNode } from 'react'
import { SectionTabs } from '@/components/layout/SectionTabs'

const TABS = [
  { href: '/archive', label: '往届存档', exact: true },
  { href: '/archive/merit', label: '功德榜' },
]

export default function ArchiveLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs tabs={TABS} label="往届导航" />
      {children}
    </>
  )
}
