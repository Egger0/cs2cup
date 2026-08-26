import Link from 'next/link'
import { Button } from '@/components/ui'
import styles from './not-found.module.css'

export const metadata = { title: '页面不存在 · 宁波理工电竞社' }

export default function NotFound() {
  return (
    <main className={styles.shell}>
      <span className={styles.glow} aria-hidden />
      <div className={styles.code}>404</div>
      <h1 className={styles.line}>这一枪打空了</h1>
      <p className={styles.hint}>
        地址不对,或者这个页面已经被撤下。从下面两个入口回到正轨。
      </p>
      <div className={styles.actions}>
        <Link href="/">
          <Button variant="primary">回社团主页</Button>
        </Link>
        <Link href="/tournaments">
          <Button>看全部赛事</Button>
        </Link>
      </div>
    </main>
  )
}
