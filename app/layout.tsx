import type { Metadata } from 'next'
import { body, display, mono } from '@/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: '宁波理工电竞社',
  description: '浙大宁波理工学院电竞社官方网站',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <noscript>
          <style>{'.reveal{opacity:1 !important;transform:none !important}'}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  )
}
