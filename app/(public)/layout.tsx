import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import { getSiteSetting, safely } from '@/lib/queries/public'
import styles from './public-theme.module.css'

export const revalidate = 0

const PUBLIC_LINKS = [
  { href: '/tournaments', label: '赛事' },
  { href: '/news', label: '动态' },
  { href: '/archive', label: '往届' },
  { href: '/games', label: '项目' },
  { href: '/about', label: '关于' },
  { href: '/guestbook', label: '留言' },
  { href: '/search', label: '搜索' },
]

const FALLBACK_SETTING = {
  id: 1,
  clubName: '宁波理工电竞社',
  clubNameEn: null,
  school: '浙大宁波理工学院',
  logoUrl: null,
  contactQq: '661543515',
  contactWechat: '无',
  footerCopy: null,
}

async function navigationAccount() {
  try {
    const database = cloudflareBindings().db
    const context = await getAuthContext({ database })
    if (context.kind === 'anonymous') return null
    if (context.session.recoveryRestricted) {
      return { hasWorkAccess: false, recoveryRestricted: true }
    }
    const access = await database
      .prepare(
        `SELECT EXISTS(
           SELECT 1 FROM identity_role_assignment
           WHERE account_id = ? AND revoked_at IS NULL
             AND granted_at <= unixepoch('now') * 1000
             AND (expires_at IS NULL OR expires_at > unixepoch('now') * 1000)
         ) AS has_work_access`,
      )
      .bind(context.account.id)
      .first<{ has_work_access: number }>()
    return { hasWorkAccess: access?.has_work_access === 1, recoveryRestricted: false }
  } catch {
    return null
  }
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [setting, overview] = await Promise.all([
    safely(getSiteSetting, FALLBACK_SETTING),
    navigationAccount(),
  ])
  if (!setting) notFound()

  const accountLinks = overview?.recoveryRestricted
    ? [{ href: '/account/security', label: '完成账号恢复' }]
    : overview
      ? [
          { href: '/me', label: '我的赛事' },
          { href: '/account#membership', label: '资格状态' },
          { href: '/account/security', label: '账号与安全' },
          ...(overview.hasWorkAccess ? [{ href: '/admin', label: '工作台' }] : []),
        ]
      : [
          { href: '/login', label: '登录' },
          { href: '/register', label: '创建账号' },
        ]
  const accountLink = overview?.recoveryRestricted
    ? { href: '/account/security', label: '继续恢复', code: 'RECOVERY / CONTINUE' }
    : overview
      ? { href: '/me', label: '我的赛事', code: 'MY / EVENTS' }
      : { href: '/login', label: '登录', code: 'ACCOUNT / LOGIN' }

  return (
    <div className={styles.theme}>
      <SiteHeader
        setting={setting}
        links={[...PUBLIC_LINKS, ...accountLinks]}
        accountLink={accountLink}
      />
      <main id="main">{children}</main>
      <SiteFooter setting={setting} />
    </div>
  )
}
