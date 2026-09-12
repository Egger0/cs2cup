import { SectionTabs } from '@/components/layout/SectionTabs'

const TABS = [
  { href: '/archive', label: '往届存档', exact: true },
  { href: '/archive/merit', label: '功德榜' },
]

export function ArchiveTabs() {
  return <SectionTabs tabs={TABS} label="往届导航" />
}
