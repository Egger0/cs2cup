export interface AccountNavLink {
  href: string
  label: string
  exact?: boolean
}

export interface AccountAccess {
  hasWorkAccess: boolean
  recoveryRestricted: boolean
}

const SECTIONS: AccountNavLink[] = [
  { href: '/me', label: '我的赛事' },
  { href: '/account', label: '我的账号', exact: true },
  { href: '/account/security', label: '登录与安全' },
]

const RECOVERY: AccountNavLink[] = [{ href: '/account/security', label: '完成账号恢复' }]

const ANONYMOUS: AccountNavLink[] = [
  { href: '/login', label: '登录' },
  { href: '/register', label: '创建账号' },
]

const WORKBENCH: AccountNavLink = { href: '/admin', label: '工作台' }

export function accountSections(access: AccountAccess): AccountNavLink[] {
  return access.recoveryRestricted ? RECOVERY : SECTIONS
}

export function accountHeaderLinks(access: AccountAccess | null): AccountNavLink[] {
  if (!access) return ANONYMOUS
  const sections = accountSections(access)
  return access.hasWorkAccess && !access.recoveryRestricted ? [...sections, WORKBENCH] : sections
}
