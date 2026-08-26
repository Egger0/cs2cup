import { Big_Shoulders, JetBrains_Mono, Noto_Sans_SC } from 'next/font/google'

export const display = Big_Shoulders({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Arial Narrow', 'Helvetica Neue Condensed', 'sans-serif'],
  adjustFontFallback: false,
})

export const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const heavy = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['900'],
  variable: '--font-heavy',
  display: 'swap',
})
