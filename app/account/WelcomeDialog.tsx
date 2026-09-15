'use client'

import Image from 'next/image'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import theme from '@/app/site-theme.module.css'
import styles from './welcome-dialog.module.css'

function forgetWelcome() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('welcome')) return
  url.searchParams.delete('welcome')
  window.history.replaceState(window.history.state, '', url)
}

export function WelcomeDialog({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const description = useId()

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const close = () => dialog.current?.close()

  return (
    <dialog
      ref={dialog}
      className={`${theme.dark} ${styles.dialog}`}
      aria-labelledby={heading}
      aria-describedby={description}
      onClose={forgetWelcome}
      onClick={event => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className={styles.sheet}>
        <header className={styles.top}>
          <span className={styles.stamp}>
            <Image src="/brand/club-mark.svg" alt="" width={28} height={28} />
            WELCOME ABOARD / 新人报到
          </span>
          <button type="button" className={styles.close} aria-label="关闭欢迎提示" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <h2 id={heading} className={styles.title}>
          账号已创建，
          <br />
          欢迎加入宁理电竞。
        </h2>
        <p id={description} className={styles.lede}>
          赛事通知、组队开黑和新人活动都在社群里。先进群打个招呼，下一场比赛就不会错过。
        </p>
        <div className={styles.channels}>
          <span className={styles.label}>先进群 / JOIN THE SQUAD</span>
          {children}
        </div>
        <footer className={styles.actions}>
          <a href="#membership" className={styles.primary} onClick={close}>
            申请成员资格 <span aria-hidden="true">→</span>
          </a>
          <button type="button" className={styles.later} onClick={close} autoFocus>
            稍后再说
          </button>
        </footer>
      </div>
    </dialog>
  )
}
