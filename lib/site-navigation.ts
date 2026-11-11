export const PUBLIC_LINKS = [
  { href: '/tournaments', label: '赛事', group: '比赛' },
  { href: '/archive', label: '往届', group: '比赛' },
  { href: '/leaderboard', label: '排行榜', group: '比赛' },
  { href: '/news', label: '动态', group: '社区' },
  { href: '/guestbook', label: '留言', group: '社区' },
  { href: '/lottery', label: '招新抽奖', group: '社区' },
  { href: '/games', label: '项目', group: '工具' },
  { href: '/loadouts', label: '改枪码', group: '工具' },
  { href: '/maps', label: '战术沙盘', group: '工具' },
  { href: '/about', label: '关于', group: '社团' },
  { href: '/handbook', label: '办赛文档', group: '社团' },
]

export const PRIMARY_LINKS = PUBLIC_LINKS.filter(link =>
  ['/tournaments', '/news', '/games', '/loadouts', '/maps'].includes(link.href),
)

export const ACCOUNT_PREFIXES = [
  '/me',
  '/account',
  '/squads',
  '/notifications',
  '/login',
  '/register',
]

export function isCurrentPath(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}
