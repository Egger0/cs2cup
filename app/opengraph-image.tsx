import { ImageResponse } from 'next/og'

export const alt = '宁波理工电竞社'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 88,
        background: 'linear-gradient(140deg, #0a101b 0%, #070b12 100%)',
        color: '#e6edf5',
      }}
    >
      <div
        style={{
          fontSize: 26,
          letterSpacing: 10,
          color: '#3d9be9',
          display: 'flex',
        }}
      >
        ESPORTS CLUB
      </div>
      <div style={{ fontSize: 108, fontWeight: 900, marginTop: 24, display: 'flex' }}>
        宁波理工电竞社
      </div>
      <div style={{ fontSize: 34, color: '#90a0b4', marginTop: 28, display: 'flex' }}>
        浙大宁波理工学院 · 办比赛,也一起开黑
      </div>
      <div
        style={{
          marginTop: 56,
          height: 4,
          width: 260,
          background: 'linear-gradient(90deg, #3d9be9, transparent)',
          display: 'flex',
        }}
      />
    </div>,
    size,
  )
}
