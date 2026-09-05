import type { Metadata, Viewport } from 'next'
import { CLUB_BRAND } from '@/lib/brand'
import { display, mono } from '@/lib/fonts'
import { resolveSiteOrigin } from '@/lib/site-config'
import styles from './noscript.module.css'
import './globals.css'

const SITE = resolveSiteOrigin()

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: '宁波理工电竞社',
    template: '%s · 宁波理工电竞社',
  },
  description: CLUB_BRAND.description,
  applicationName: CLUB_BRAND.shortName,
  appleWebApp: { capable: true, title: CLUB_BRAND.shortName, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: { url: '/brand/club-mark.svg', type: 'image/svg+xml' },
    shortcut: '/brand/club-mark.svg',
    apple: '/brand/apple-touch-icon.png',
  },
  alternates: { types: { 'application/rss+xml': `${SITE}/feed.xml` } },
  openGraph: {
    type: 'website',
    siteName: '宁波理工电竞社',
    locale: 'zh_CN',
  },
  twitter: { card: 'summary_large_image' },
}

export const viewport: Viewport = { themeColor: '#171817' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${display.variable} ${mono.variable}`}
      data-scroll-behavior="smooth"
    >
      <head>
        <noscript>
          <style>{'.reveal{opacity:1 !important;transform:none !important}'}</style>
        </noscript>
      </head>
      <body>
        <noscript>
          <section className={styles.notice} aria-label="页面加载提示">
            <strong>宁理电竞社 · 请启用 JavaScript</strong>
            <p>
              当前页面需要浏览器脚本完成加载。请启用 JavaScript 后刷新，即可继续浏览赛事和报名。
            </p>
          </section>
        </noscript>
        <a href="#main" className="skip">
          跳到主内容
        </a>
        <span className="scrollbar" aria-hidden />
        {children}
      </body>
    </html>
  )
}
