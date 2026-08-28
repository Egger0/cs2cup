import type { Metadata } from 'next'
import { display, mono } from '@/lib/fonts'
import { resolveSiteOrigin } from '@/lib/site-config'
import './globals.css'

const SITE = resolveSiteOrigin()

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: '宁波理工电竞社',
    template: '%s · 宁波理工电竞社',
  },
  description: '浙大宁波理工学院电竞社官方网站。赛事、战队、对阵与社团动态。',
  icons: {
    icon: { url: '/brand/club-logo.jpg', type: 'image/jpeg' },
    shortcut: '/brand/club-logo.jpg',
    apple: '/brand/club-logo.jpg',
  },
  alternates: { types: { 'application/rss+xml': `${SITE}/feed.xml` } },
  openGraph: {
    type: 'website',
    siteName: '宁波理工电竞社',
    locale: 'zh_CN',
  },
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${display.variable} ${mono.variable}`}>
      <head>
        <noscript>
          <style>{'.reveal{opacity:1 !important;transform:none !important}'}</style>
        </noscript>
      </head>
      <body>
        <a href="#main" className="skip">
          跳到主内容
        </a>
        <span className="scrollbar" aria-hidden />
        {children}
      </body>
    </html>
  )
}
