import type { ReactNode } from 'react'
import type { PlatformConsoleCapability } from '@/lib/auth'
import { AdminRail } from './AdminRail'

const GROUPS = ['赛事', '内容', '社区', '成员与系统'] as const

const LINKS = [
  {
    index: '01',
    href: '/admin',
    label: '报名与赛果',
    group: '赛事',
    exact: true,
    capability: 'platform.configure',
  },
  { index: '03', href: '/admin/tournaments', label: '赛事', group: '赛事' },
  { index: '04', href: '/admin/games', label: '项目', group: '赛事' },
  { index: '10', href: '/admin/lottery', label: '抽奖核销', group: '赛事' },
  { index: '05', href: '/admin/posts', label: '动态', group: '内容' },
  { index: '06', href: '/admin/photos', label: '素材', group: '内容' },
  { index: '12', href: '/admin/handbook', label: '办赛文档', group: '内容' },
  { index: '13', href: '/admin/graphics', label: '画质方案', group: '内容' },
  { index: '08', href: '/admin/guestbook', label: '留言', group: '社区' },
  { index: '11', href: '/admin/loadouts', label: '改枪码', group: '社区' },
  { index: '14', href: '/admin/routes', label: '沙盘路线', group: '社区' },
  {
    index: '02',
    href: '/admin/identity',
    label: '资格审核',
    group: '成员与系统',
    capability: 'platform.identity.review',
  },
  { index: '07', href: '/admin/members', label: '成员', group: '成员与系统' },
  { index: '09', href: '/admin/settings', label: '设置', group: '成员与系统' },
] satisfies readonly {
  index: string
  href: string
  label: string
  group: (typeof GROUPS)[number]
  exact?: boolean
  capability?: PlatformConsoleCapability
}[]

export function AdminNav({
  capabilities,
  hasProjectWork,
  hasTournamentWork,
  holdsReviewRole,
  trailing,
}: {
  capabilities: readonly PlatformConsoleCapability[]
  hasProjectWork: boolean
  hasTournamentWork: boolean
  holdsReviewRole: boolean
  trailing?: ReactNode
}) {
  const configures = capabilities.includes('platform.configure')
  const links = LINKS.filter(
    link =>
      capabilities.includes(link.capability ?? 'platform.configure') ||
      (link.href === '/admin' && hasTournamentWork) ||
      (link.href === '/admin/tournaments' && hasProjectWork) ||
      (link.href === '/admin/photos' && hasProjectWork) ||
      (link.capability === 'platform.identity.review' && holdsReviewRole),
  ).map(link => ({
    ...link,
    label:
      link.href === '/admin' && !configures
        ? '我的工作区'
        : link.href === '/admin/tournaments' && hasProjectWork && !configures
          ? '项目工作台'
          : link.label,
  }))

  return (
    <AdminRail
      groups={GROUPS.map(label => ({
        label,
        links: links.filter(link => link.group === label),
      })).filter(group => group.links.length)}
      trailing={trailing}
    />
  )
}
