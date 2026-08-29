export const dynamic = 'force-dynamic'

export const metadata = { title: '后台登录 · 宁波理工电竞社' }

export default async function LoginPage() {
  return (
    <main className="wrap section">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', marginBottom: 24 }}>
        后台访问受 Cloudflare Access 保护
      </h1>
      <p>请使用 Cloudflare Access 的授权身份访问后台。</p>
    </main>
  )
}
