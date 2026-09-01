import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

export const alt = '宁波理工电竞社｜从八强，到冠军'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpengraphImage() {
  const [mark, serif] = await Promise.all([
    readFile(join(process.cwd(), 'public/brand/club-mark.svg')),
    readFile(join(process.cwd(), 'public/fonts/noto-serif-sc-og-800.ttf')),
  ])
  const markSrc = `data:image/svg+xml;base64,${mark.toString('base64')}`

  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        color: '#f1efe8',
        background: '#171817',
      }}
    >
      <svg
        viewBox="0 0 1200 630"
        width="1200"
        height="630"
        style={{ position: 'absolute', inset: 0 }}
      >
        <g fill="none" stroke="rgba(241,239,232,0.24)" strokeWidth="1">
          <path d="M0 95H145V155H0M0 245H145V305H0M0 395H145V455H0M0 545H145V605H0" />
          <path d="M145 125H280V275H145M145 425H280V575H145M280 200H420V500H280M420 350H585" />
          <path d="M1200 95H1055V155H1200M1200 245H1055V305H1200M1200 395H1055V455H1200M1200 545H1055V605H1200" />
          <path d="M1055 125H920V275H1055M1055 425H920V575H1055M920 200H780V500H920M780 350H615" />
        </g>
        <path d="M600 34V596" stroke="#0b4d87" strokeWidth="3" />
        <rect x="583" y="333" width="34" height="34" fill="#0b4d87" />
      </svg>

      <div
        style={{
          position: 'absolute',
          inset: 32,
          display: 'flex',
          border: '1px solid rgba(241,239,232,0.1)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 55,
          left: 64,
          display: 'flex',
          color: 'rgba(241,239,232,0.6)',
          fontSize: 15,
          letterSpacing: 3,
        }}
      >
        浙大宁波理工学院 · 2022—
      </div>

      <img
        src={markSrc}
        alt=""
        width="320"
        height="320"
        style={{ position: 'absolute', top: 112, right: 92, width: 320, height: 320 }}
      />

      <div
        style={{
          position: 'absolute',
          top: 176,
          left: 76,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          fontFamily: 'NLC Serif',
          fontSize: 132,
          fontWeight: 800,
          letterSpacing: '-0.09em',
          lineHeight: 0.8,
        }}
      >
        <div style={{ display: 'flex' }}>宁理</div>
        <div style={{ display: 'flex', marginTop: -2, marginLeft: 86 }}>电竞社</div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 52,
          left: 66,
          display: 'flex',
          gap: 28,
          color: 'rgba(241,239,232,0.58)',
          fontSize: 14,
          letterSpacing: 2,
        }}
      >
        <span>08 八强</span>
        <span>04 四强</span>
        <span>02 决赛</span>
        <span style={{ color: '#5e95c2' }}>01 冠军</span>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 64,
          bottom: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          color: 'rgba(241,239,232,0.7)',
          fontSize: 15,
          letterSpacing: 2,
        }}
      >
        <span>NINGLI ESPORTS CLUB</span>
        <span style={{ color: '#0b4d87', fontSize: 22 }}>01</span>
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: 'NLC Serif', data: serif, style: 'normal', weight: 800 }],
    },
  )
}
