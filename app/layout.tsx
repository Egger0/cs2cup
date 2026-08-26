import type { Metadata } from 'next'
import { body, display, stat } from '@/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: '宁波理工电竞社',
  description: '浙大宁波理工学院电竞社官方网站',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${display.variable} ${body.variable} ${stat.variable}`}>
      <body>{children}</body>
    </html>
  )
}
