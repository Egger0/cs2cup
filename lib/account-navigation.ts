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
  { href: '/notifications', label: '消息' },
  { href: '/squads', label: '我的战队' },
  { href: '/account', label: '账号与安全' },
]

const RECOVERY: AccountNavLink[] = [{ href: '/account/security', label: '完成账号恢复' }]

const ANONYMOUS: AccountNavLink[] = [
  { href: '/login', label: '登录' },
  { href: '/register', label: '创建账号' },
]

const WORKBENCH: AccountNavLink = { href: '/admin', label: '工作台' }

export function accountSections(access: AccountAccess): AccountNavLink[] {
  if (access.recoveryRestricted) return RECOVERY
  return access.hasWorkAccess ? [...SECTIONS, WORKBENCH] : SECTIONS
}

export function accountHeaderLinks(access: AccountAccess | null): AccountNavLink[] {
  return access ? accountSections(access) : ANONYMOUS
}
