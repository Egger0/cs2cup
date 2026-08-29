export const dynamic = 'force-dynamic'

export const metadata = { title: '后台登录 · 宁波理工电竞社' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = (await searchParams).error === '1'
  const unavailable = (await searchParams).error === 'setup'
  return (
    <main className="wrap section">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', marginBottom: 24 }}>
        后台登录
      </h1>
      <form action="/admin/session" method="post" style={{ display: 'grid', gap: 16, maxWidth: 360 }}>
        <label>
          管理员账号
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          密码
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error ? <p role="alert">账号或密码错误。</p> : null}
        {unavailable ? <p role="alert">登录服务暂不可用。</p> : null}
        <button type="submit">登录后台</button>
      </form>
    </main>
  )
}
