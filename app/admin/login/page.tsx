import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: '后台登录 · 宁波理工电竞社' }

export default async function LoginPage() {
  if (await getCurrentAdmin().catch(() => null)) redirect('/admin')

  const env = process.env.CLOUDBASE_ENV_ID
  const anonKey = process.env.CLOUDBASE_ANON_KEY
  const region = process.env.CLOUDBASE_REGION ?? 'ap-shanghai'

  return (
    <main className="wrap section">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', marginBottom: 24 }}>
        后台登录
      </h1>
      {env && anonKey ? (
        <LoginForm env={env} anonKey={anonKey} region={region} />
      ) : (
        <p style={{ color: 'var(--c4)' }}>
          未配置 CLOUDBASE_ENV_ID 与 CLOUDBASE_ANON_KEY,无法登录。
        </p>
      )}
    </main>
  )
}
