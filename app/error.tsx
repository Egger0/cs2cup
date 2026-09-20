'use client'

import { Button, ButtonLink } from '@/components/ui'
import styles from './fault.module.css'
import theme from '@/app/site-theme.module.css'

export default function Fault({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className={`${theme.dark} ${styles.shell}`}>
      <span className={styles.glow} aria-hidden />
      <div className={styles.code}>ERR</div>
      <h1 className={styles.line}>这一局掉线了</h1>
      <p className={styles.hint}>页面没能加载完。重试一次通常就好，不行就先回主页。</p>
      <div className={styles.actions}>
        <Button type="button" variant="primary" onClick={reset}>
          重试
        </Button>
        <ButtonLink href="/">回社团主页</ButtonLink>
      </div>
    </main>
  )
}
