import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Button, Field } from '@/components/ui'
import {
  getCurrentUnifiedPlatformOwner,
  hasConflictingLegacySessions,
  hasCurrentLegacyAdminSession,
} from '@/lib/auth'
import { getAuthContext } from '@/lib/identity/kernel'
import { getCurrentLegacyParticipantSession } from '@/lib/participant-auth'
import styles from '../login/login.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: { absolute: '统一负责人账号' } }

const ERRORS: Record<string, string> = {
  already_completed: '负责人账号迁移已经完成，请使用统一登录入口。',
  authority: '旧管理员会话已失效，请重新登录后继续。',
  conflict: '迁移状态已经改变，请刷新后重试。',
  invalid_input: '请检查用户名、显示名称与密码要求。',
  password_compromised: '这个密码曾出现在公开泄露记录中，请换一个只在这里使用的密码。',
  rate: '尝试过于频繁，请稍后再试。',
  request: '请求来源无法确认，请刷新页面后重试。',
  screening_unavailable: '暂时无法安全检查新密码，请稍后重试。',
  setup: '迁移服务暂时不可用，请稍后重试。',
  unauthorized: '旧管理员会话已失效，请重新登录后继续。',
  username_unavailable: '这个用户名不可用，请换一个再试。',
}

export default async function AdminBootstrapPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const [params, context, owner, legacyAdmin, participant, conflict] = await Promise.all([
    searchParams,
    getAuthContext(),
    getCurrentUnifiedPlatformOwner(),
    hasCurrentLegacyAdminSession(),
    getCurrentLegacyParticipantSession(),
    hasConflictingLegacySessions(),
  ])
  if (owner) redirect('/admin')
  if (context.kind === 'authenticated') {
    redirect(context.session.recoveryRestricted ? '/account/security?recovery=1' : '/account')
  }
  if (participant || conflict) redirect('/login?reason=conflict&reauth=admin')
  if (!legacyAdmin) redirect('/admin/login')
  const error = typeof params.error === 'string' ? ERRORS[params.error] : null

  return (
    <main id="main" className={styles.page}>
      <section className={styles.intro} aria-labelledby="bootstrap-title">
        <div className={styles.brand} aria-hidden="true">
          N
        </div>
        <p className={styles.eyebrow}>IDENTITY CUTOVER / ONE TIME</p>
        <h1 id="bootstrap-title">把管理员也放回同一个账号体系。</h1>
        <p className={styles.lede}>
          这是一次性迁移。设置新的统一账号后，旧后台会话立即失效；以后从普通登录页进入工作台。
        </p>
        <Link href="/" className={styles.back}>
          ← 暂时返回网站
        </Link>
      </section>

      <section className={styles.card} aria-labelledby="bootstrap-form-title">
        <p className={styles.serial}>PLATFORM OWNER / MIGRATION</p>
        <h2 id="bootstrap-form-title">创建统一负责人账号</h2>
        <form action="/api/auth/bootstrap" method="post" className={styles.form}>
          <Field
            id="owner-username"
            name="username"
            label="新用户名"
            hint="3–32 位小写字母、数字、点、短横线或下划线"
            autoComplete="username"
            maxLength={32}
            required
          />
          <Field
            id="owner-display-name"
            name="displayName"
            label="显示名称"
            autoComplete="nickname"
            maxLength={80}
            required
          />
          <Field
            id="owner-password"
            name="password"
            label="新密码"
            hint="至少 15 个字符，建议使用易记长句"
            type="password"
            autoComplete="new-password"
            maxLength={1024}
            required
          />
          <Field
            id="owner-password-confirmation"
            name="passwordConfirmation"
            label="确认新密码"
            type="password"
            autoComplete="new-password"
            maxLength={1024}
            required
          />
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" className={styles.submit}>
            完成迁移并进入工作台
          </Button>
        </form>
        <p className={styles.note}>仅可执行一次 · 密码不会复制 · 旧会话完成后失效</p>
      </section>
    </main>
  )
}
