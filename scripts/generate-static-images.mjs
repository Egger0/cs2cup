import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const OG_OUTPUT = fileURLToPath(new URL('../app/opengraph-image.png', import.meta.url))
const QR_INPUT = fileURLToPath(new URL('../public/brand/douyin-qr.png', import.meta.url))
const QR_OUTPUT = fileURLToPath(new URL('../public/brand/douyin-qr-display.png', import.meta.url))

const mark = await readFile(new URL('../public/brand/club-mark.svg', import.meta.url))
const serif = await readFile(new URL('../public/fonts/noto-serif-sc-og-800.ttf', import.meta.url))

const markData = mark.toString('base64')
const serifData = serif.toString('base64')
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <style>
      @font-face {
        font-family: 'NLC Serif';
        src: url('data:font/ttf;base64,${serifData}') format('truetype');
        font-weight: 800;
      }
      .display { font-family: 'NLC Serif', serif; font-weight: 800; fill: #f1efe8; }
      .label { font-family: sans-serif; fill: rgba(241, 239, 232, 0.62); }
    </style>
  </defs>
  <rect width="1200" height="630" fill="#171817" />
  <g fill="none" stroke="rgba(241,239,232,0.24)" stroke-width="1">
    <path d="M0 95H145V155H0M0 245H145V305H0M0 395H145V455H0M0 545H145V605H0" />
    <path d="M145 125H280V275H145M145 425H280V575H145M280 200H420V500H280M420 350H585" />
    <path d="M1200 95H1055V155H1200M1200 245H1055V305H1200M1200 395H1055V455H1200M1200 545H1055V605H1200" />
    <path d="M1055 125H920V275H1055M1055 425H920V575H1055M920 200H780V500H920M780 350H615" />
  </g>
  <path d="M600 34V596" stroke="#0b4d87" stroke-width="3" />
  <rect x="583" y="333" width="34" height="34" fill="#0b4d87" />
  <rect x="32.5" y="32.5" width="1135" height="565" fill="none" stroke="rgba(241,239,232,0.1)" />
  <text x="64" y="72" class="label" font-size="15" letter-spacing="3">浙大宁波理工学院 · 2022—</text>
  <image href="data:image/svg+xml;base64,${markData}" x="788" y="112" width="320" height="320" />
  <text x="76" y="284" class="display" font-size="132" letter-spacing="-10">宁理</text>
  <text x="162" y="385" class="display" font-size="132" letter-spacing="-10">电竞社</text>
  <g class="label" font-size="14" letter-spacing="2">
    <text x="66" y="568">08 八强</text>
    <text x="174" y="568">04 四强</text>
    <text x="282" y="568">02 决赛</text>
    <text x="390" y="568" fill="#5e95c2">01 冠军</text>
  </g>
  <text x="887" y="568" class="label" font-size="15" letter-spacing="2">NINGLI ESPORTS CLUB</text>
  <text x="1111" y="570" fill="#0b4d87" font-family="sans-serif" font-size="22">01</text>
</svg>`

const [og, qr] = await Promise.all([
  sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(OG_OUTPUT),
  sharp(QR_INPUT)
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 100, colours: 256, dither: 0 })
    .toFile(QR_OUTPUT),
])

if (og.width !== 1200 || og.height !== 630 || qr.width !== 256 || qr.height !== 256) {
  throw new Error('Generated static image dimensions are invalid')
}
console.log('Generated static Open Graph and Douyin images')
