import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button, Field } from '@/components/ui'
import { MAX_ADMIN_PASSWORD_LENGTH, MAX_ADMIN_USERNAME_LENGTH } from '@/lib/admin-login-request'
import { getCurrentAdmin } from '@/lib/auth'
import styles from './login.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: { absolute: '后台登录' } }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const [params, admin] = await Promise.all([searchParams, getCurrentAdmin()])
  if (admin) redirect('/admin')

  const errorCode = params.error
  const rejected = errorCode === '1'
  const rateLimited = errorCode === 'rate'
  const unavailable = errorCode === 'setup'
  return (
    <main id="main" className={styles.page}>
      <section className={styles.intro} aria-labelledby="admin-login-title">
        <div className={styles.brand} aria-hidden="true">
          N
        </div>
        <p className={styles.eyebrow}>NINGBOTECH ESPORTS / CONTROL ROOM</p>
        <h1 id="admin-login-title">把比赛留在场上，秩序留在这里。</h1>
        <p className={styles.lede}>赛事、成员与内容的内部工作台。</p>
        <Link href="/" className={styles.back}>
          ← 返回网站
        </Link>
      </section>

      <section className={styles.card} aria-labelledby="access-title">
        <p className={styles.serial}>SECURE ACCESS / 01</p>
        <h2 id="access-title">管理员登录</h2>
        <form action="/admin/session" method="post" className={styles.form}>
          <Field
            id="admin-username"
            name="username"
            label="管理员账号"
            autoComplete="username"
            maxLength={MAX_ADMIN_USERNAME_LENGTH}
            required
          />
          <Field
            id="admin-password"
            name="password"
            label="密码"
            type="password"
            autoComplete="current-password"
            maxLength={MAX_ADMIN_PASSWORD_LENGTH}
            required
          />
          {rejected ? (
            <p className={styles.error} role="alert">
              账号或密码未通过验证，请重新输入。
            </p>
          ) : null}
          {rateLimited ? (
            <p className={`${styles.error} ${styles.rate}`} role="status">
              尝试过于频繁，请稍后再试。
            </p>
          ) : null}
          {unavailable ? (
            <p className={styles.error} role="alert">
              登录服务暂时不可用，请稍后重试。
            </p>
          ) : null}
          <Button type="submit" variant="primary" className={styles.submit}>
            进入控制台
          </Button>
        </form>
        <p className={styles.note}>仅限授权成员 · 会话受到安全策略保护</p>
      </section>
    </main>
  )
}
