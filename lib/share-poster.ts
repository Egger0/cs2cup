import { CLUB_BRAND } from './brand'

export interface PublicShare {
  title: string
  text: string
  url: string
  label?: string
}

function image(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('Brand image could not be loaded'))
    element.src = source
  })
}

function lines(context: CanvasRenderingContext2D, value: string, width: number, maximum: number) {
  const result: string[] = []
  let line = ''
  const tokens =
    value
      .replace(/\s+/g, ' ')
      .trim()
      .match(/[A-Za-z0-9][A-Za-z0-9:./_-]*|[^\s]|\s+/gu) ?? []
  for (const token of tokens) {
    const parts = context.measureText(token).width > width ? Array.from(token) : [token]
    for (const part of parts) {
      if (context.measureText(line + part).width > width && line) {
        result.push(line.trimEnd())
        line = part.trimStart()
      } else line += part
    }
  }
  if (line) result.push(line)
  if (result.length > maximum) {
    let last = result[maximum - 1] ?? ''
    while (context.measureText(`${last}…`).width > width) last = last.slice(0, -1)
    result[maximum - 1] = `${last}…`
  }
  return result.slice(0, maximum)
}

export async function createSharePoster(share: PublicShare): Promise<Blob> {
  const [qr, mark] = await Promise.all([import('qrcode'), image('/brand/club-mark.svg')])
  const canvas = document.createElement('canvas')
  canvas.width = 720
  canvas.height = 900
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.fillStyle = '#f1efe8'
  context.fillRect(0, 0, 720, 900)
  context.fillStyle = '#0b4d87'
  context.fillRect(0, 0, 12, 900)
  context.fillRect(0, 864, 720, 36)
  context.drawImage(mark, 48, 40, 72, 72)
  context.fillStyle = '#171817'
  context.font = '700 23px sans-serif'
  context.fillText(CLUB_BRAND.shortName, 140, 71)
  context.fillStyle = '#5f605a'
  context.font = '12px monospace'
  context.fillText(CLUB_BRAND.englishName, 140, 98)

  context.strokeStyle = '#c9c6bc'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(48, 143)
  context.lineTo(672, 143)
  context.moveTo(48, 598)
  context.lineTo(672, 598)
  context.stroke()
  context.fillStyle = '#0b4d87'
  context.font = '600 17px sans-serif'
  context.fillText(share.label ?? '宁理电竞 · 邀你一起', 48, 190)
  context.fillStyle = '#171817'
  context.font = '800 53px sans-serif'
  lines(context, share.title, 610, 3).forEach((line, index) =>
    context.fillText(line, 48, 273 + index * 72),
  )
  context.fillStyle = '#5f605a'
  context.font = '21px sans-serif'
  lines(context, share.text, 610, 3).forEach((line, index) =>
    context.fillText(line, 48, 488 + index * 33),
  )

  const code = document.createElement('canvas')
  await qr.toCanvas(code, share.url, {
    width: 204,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#0b4d87', light: '#ffffff' },
  })
  context.drawImage(code, 48, 625, 204, 204)
  context.fillStyle = '#171817'
  context.font = '700 27px sans-serif'
  context.fillText('扫码，下一场见。', 282, 690)
  context.font = '18px sans-serif'
  context.fillStyle = '#5f605a'
  context.fillText(CLUB_BRAND.tagline, 282, 728)
  context.font = '14px monospace'
  lines(context, new URL(share.url).host, 375, 2).forEach((line, index) =>
    context.fillText(line, 282, 775 + index * 22),
  )
  context.fillStyle = '#f1efe8'
  context.font = '12px monospace'
  context.fillText('NINGLI ESPORTS CLUB / PLAY. CONNECT. BELONG.', 48, 887)
  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Share image could not be created'))
    }, 'image/png'),
  )
}
