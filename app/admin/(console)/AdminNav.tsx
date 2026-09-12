import type { ReactNode } from 'react'
import { SectionTabs } from '@/components/layout/SectionTabs'
import type { PlatformConsoleCapability } from '@/lib/auth'

const LINKS = [
  {
    index: '01',
    href: '/admin',
    label: '报名与赛果',
    exact: true,
    capability: 'platform.configure',
  },
  {
    index: '02',
    href: '/admin/identity',
    label: '资格审核',
    capability: 'platform.identity.review',
  },
  { index: '03', href: '/admin/tournaments', label: '赛事', capability: 'platform.configure' },
  { index: '04', href: '/admin/games', label: '项目', capability: 'platform.configure' },
  { index: '05', href: '/admin/posts', label: '动态', capability: 'platform.configure' },
  { index: '06', href: '/admin/photos', label: '素材', capability: 'platform.configure' },
  { index: '07', href: '/admin/members', label: '成员', capability: 'platform.configure' },
  { index: '08', href: '/admin/guestbook', label: '留言', capability: 'platform.configure' },
  { index: '09', href: '/admin/settings', label: '设置', capability: 'platform.configure' },
  { index: '10', href: '/admin/lottery', label: '抽奖核销', capability: 'platform.configure' },
] satisfies readonly {
  index: string
  href: string
  label: string
  exact?: boolean
  capability: PlatformConsoleCapability
}[]

export function AdminNav({
  capabilities,
  hasTournamentWork,
  trailing,
}: {
  capabilities: readonly PlatformConsoleCapability[]
  hasTournamentWork: boolean
  trailing?: ReactNode
}) {
  const tabs = LINKS.filter(
    link => capabilities.includes(link.capability) || (link.href === '/admin' && hasTournamentWork),
  ).map(link => ({
    href: link.href,
    exact: link.exact,
    label:
      link.href === '/admin' && !capabilities.includes('platform.configure')
        ? '我的工作区'
        : link.label,
  }))

  return <SectionTabs tabs={tabs} label="后台导航" trailing={trailing} />
}
