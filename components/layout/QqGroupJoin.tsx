'use client'

import Image from 'next/image'
import { useId, useRef, useState } from 'react'
import styles from './SiteFooter.module.css'

const APP_WAIT_MS = 1200

export function QqGroupJoin({ number }: { number: string }) {
  const [status, setStatus] = useState<'idle' | 'opening' | 'copied' | 'manual'>('idle')
  const timer = useRef<number | null>(null)
  const hintId = useId()

  function join() {
    if (timer.current) window.clearTimeout(timer.current)
    setStatus('opening')
    let left = false
    const noteLeaving = () => {
      if (document.visibilityState === 'hidden') left = true
    }
    document.addEventListener('visibilitychange', noteLeaving)
    window.location.href = `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${number}&card_type=group&source=qrcode`
    timer.current = window.setTimeout(() => {
      document.removeEventListener('visibilitychange', noteLeaving)
      if (left) {
        setStatus('idle')
        return
      }
      navigator.clipboard.writeText(number).then(
        () => setStatus('copied'),
        () => setStatus('manual'),
      )
    }, APP_WAIT_MS)
  }

  return (
    <span className={styles.qqControl}>
      <button
        type="button"
        className={styles.chip}
        aria-label={`加入 QQ 群 ${number}`}
        aria-describedby={hintId}
        onClick={join}
      >
        <span className={styles.chipIcon} aria-hidden="true">
          <Image src="/brand/qq.svg" alt="" width={20} height={20} />
        </span>
        <span>加入 QQ 群</span>
        <small>{number}</small>
      </button>
      <span id={hintId} className={styles.qqHint} role="status">
        {status === 'copied'
          ? '未检测到 QQ，已复制群号，可在 QQ 中搜索加入'
          : status === 'manual'
            ? `未检测到 QQ，请在 QQ 中搜索群号 ${number}`
            : ''}
      </span>
    </span>
  )
}
