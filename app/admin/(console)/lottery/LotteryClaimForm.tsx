'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { claimRecruitmentLotteryPrizeAction } from '../actions/lottery'
import styles from '../admin.module.css'
import scannerStyles from './LotteryClaimForm.module.css'

interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>
}

interface NativeBarcodeDetectorConstructor {
  new (options: { formats: string[] }): NativeBarcodeDetector
}

declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorConstructor
  }
}

function codeFromScan(value: string) {
  const match = /^NBTLOTTERY:([A-Z0-9]{10})$/i.exec(value.trim())
  return match?.[1]?.toUpperCase() ?? null
}

export function LotteryClaimForm() {
  const input = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const frame = useRef<number | null>(null)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [scanning, setScanning] = useState(false)

  function stopScanner() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    setScanning(false)
  }

  function claim(code: string) {
    setFeedback(null)
    startTransition(async () => {
      const result = await claimRecruitmentLotteryPrizeAction(code)
      if (!result.ok) {
        setFeedback({ ok: false, message: result.error })
        return
      }
      if (input.current) input.current.value = ''
      setFeedback({ ok: true, message: `已核销：${result.prizeTitle}` })
    })
  }

  async function startScanner() {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setFeedback({ ok: false, message: '当前浏览器不支持扫码，请改用下方核销码。' })
      return
    }
    try {
      setScanning(true)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      stream.current = camera
      if (!video.current) throw new Error('camera preview unavailable')
      video.current.srcObject = camera
      await video.current.play()
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      setFeedback(null)
      const scan = async () => {
        if (!video.current || !stream.current) return
        const found = await detector.detect(video.current).catch(() => [])
        const code = found[0]?.rawValue ? codeFromScan(found[0].rawValue) : null
        if (code) {
          stopScanner()
          claim(code)
          return
        }
        frame.current = requestAnimationFrame(() => void scan())
      }
      await scan()
    } catch {
      stopScanner()
      setFeedback({ ok: false, message: '无法打开摄像头，请允许权限后重试，或改用核销码。' })
    }
  }

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      stream.current?.getTracks().forEach(track => track.stop())
    },
    [],
  )

  return (
    <form
      className={styles.editor}
      onSubmit={event => {
        event.preventDefault()
        claim(input.current?.value ?? '')
      }}
    >
      <div className={styles.rowActions}>
        <Button
          type="button"
          variant="primary"
          disabled={pending || scanning}
          onClick={() => void startScanner()}
        >
          {scanning ? '正在扫码…' : '打开摄像头扫码'}
        </Button>
        {scanning ? (
          <Button type="button" disabled={pending} onClick={stopScanner}>
            停止扫码
          </Button>
        ) : null}
      </div>
      {scanning ? (
        <video ref={video} autoPlay muted playsInline className={scannerStyles.scanner} />
      ) : null}
      <label className={styles.controlLabel}>
        <span>核销码（扫码不可用时备用）</span>
        <input
          ref={input}
          className={styles.select}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={10}
          placeholder="例如 A1B2C3D4E5"
          required
        />
      </label>
      <div className={styles.rowActions}>
        <Button type="submit" disabled={pending}>
          {pending ? '核销中…' : '确认核销'}
        </Button>
        {feedback ? (
          <span
            className={feedback.ok ? styles.ok : styles.error}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
