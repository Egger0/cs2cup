import Link from 'next/link'

import styles from './operations.module.css'

export function IdentityPagination({
  label,
  page,
  pages,
  previousHref,
  nextHref,
}: {
  label: string
  page: number
  pages: number
  previousHref: string | null
  nextHref: string | null
}) {
  if (pages <= 1) return null
  return (
    <nav className={styles.pagination} aria-label={label}>
      {previousHref ? <Link href={previousHref}>上一页</Link> : <span />}
      <span>
        第 {page} / {pages} 页
      </span>
      {nextHref ? <Link href={nextHref}>下一页</Link> : <span />}
    </nav>
  )
}
