import { Button, Field } from '@/components/ui'
import styles from './login.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '后台登录 · 宁波理工电竞社' }

const ERROR_MESSAGES = {
  invalid: '账号或密码错误。',
  rate: '尝试次数过多，请稍后再试。',
  unavailable: '登录服务暂时不可用，请稍后再试。',
} as const

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const error = (await searchParams).error
  const message = error && error in ERROR_MESSAGES
    ? ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES]
    : null

  return (
    <main className={`wrap section ${styles.shell}`}>
      <div className={styles.card}>
        <div className="readout">Administrator</div>
        <h1 className={styles.title}>后台登录</h1>
        <form action="/admin/session" method="post" className={styles.form}>
          <Field
            id="admin-username"
            name="username"
            label="管理员账号"
            autoComplete="username"
            maxLength={128}
            required
          />
          <Field
            id="admin-password"
            name="password"
            label="密码"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
          />
          {message ? <p className={styles.error} role="alert">{message}</p> : null}
          <Button type="submit" variant="primary">登录后台</Button>
        </form>
      </div>
    </main>
  )
}
