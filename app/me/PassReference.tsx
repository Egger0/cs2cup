'use client'

import { useState } from 'react'
import styles from './pass-reference.module.css'

type CopyState = 'idle' | 'copying' | 'copied' | 'failed'

const COPY_FEEDBACK: Record<Exclude<CopyState, 'idle' | 'copying'>, string> = {
  copied: '脱敏旧登录编号已复制。',
  failed: '未能自动复制，请选中编号手动复制。',
}

export function PassReference({ participantReference }: { participantReference: string }) {
  const [copyState, setCopyState] = useState<CopyState>('idle')

  async function copyReference() {
    if (copyState === 'copying') return
    setCopyState('copying')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(participantReference)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const feedback = copyState === 'copied' || copyState === 'failed' ? COPY_FEEDBACK[copyState] : ''

  return (
    <section className={styles.pass} aria-labelledby="pass-reference-title">
      <header className={styles.heading}>
        <span>LEGACY REFERENCE / 旧登录编号</span>
        <h2 id="pass-reference-title">现场核对索引</h2>
      </header>

      <input
        className={styles.reference}
        value={participantReference}
        aria-label="脱敏旧登录编号，可选中后手动复制"
        aria-describedby="pass-reference-note"
        autoComplete="off"
        readOnly
        spellCheck="false"
        onFocus={event => event.currentTarget.select()}
      />

      <p className={styles.note} id="pass-reference-note">
        仅用于赛事负责人查找你的账号，不是登录凭据或身份证明。
      </p>

      <button
        type="button"
        className={styles.copy}
        disabled={copyState === 'copying'}
        aria-describedby="pass-reference-note pass-reference-status"
        onClick={copyReference}
      >
        {copyState === 'copying' ? '正在复制…' : '复制编号'}
      </button>

      <p
        id="pass-reference-status"
        className={copyState === 'failed' ? styles.failure : styles.feedback}
        role={copyState === 'failed' ? 'alert' : 'status'}
        aria-live={copyState === 'failed' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        {feedback}
      </p>
    </section>
  )
}
