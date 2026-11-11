export const PUBLIC_LINKS = [
  { href: '/tournaments', label: '赛事', group: '浏览' },
  { href: '/news', label: '动态', group: '浏览' },
  { href: '/games', label: '项目', group: '浏览' },
  { href: '/loadouts', label: '改枪码', group: '工具' },
  { href: '/maps', label: '战术沙盘', group: '工具' },
  { href: '/handbook', label: '办赛文档', group: '工具' },
  { href: '/about', label: '关于', group: '社团' },
]

export const LOTTERY_LINK = { href: '/lottery', label: '招新抽奖', group: '社团' }

export const PRIMARY_LINKS = PUBLIC_LINKS.filter(link =>
  ['/tournaments', '/news', '/games'].includes(link.href),
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
