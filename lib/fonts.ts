import { Chakra_Petch, Noto_Sans_SC, Teko } from 'next/font/google'

export const display = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
})

export const body = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-body',
  display: 'swap',
})

export const stat = Teko({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-stat',
  display: 'swap',
})
