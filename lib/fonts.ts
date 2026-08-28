import localFont from 'next/font/local'

export const display = localFont({
  src: '../node_modules/@fontsource-variable/big-shoulders/files/big-shoulders-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
  fallback: ['Arial Narrow', 'Helvetica Neue Condensed', 'sans-serif'],
  adjustFontFallback: false,
  preload: true,
})

export const mono = localFont({
  src: '../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
  adjustFontFallback: false,
  preload: true,
})
