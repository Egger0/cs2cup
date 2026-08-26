import { Big_Shoulders, JetBrains_Mono, Noto_Sans_SC } from 'next/font/google'

export const display = Big_Shoulders({
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Arial Narrow', 'Helvetica Neue Condensed', 'sans-serif'],
  adjustFontFallback: false,
})

export const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const body = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-body',
  display: 'swap',
})
