import Link from 'next/link'
import { CopyTextButton } from '@/components/ui/CopyTextButton'
import type { LoadoutCode } from '@/lib/loadout-codes'
import styles from './LoadoutCodeList.module.css'

const STATUS = { pending: '审核中', approved: '已展示', rejected: '未通过' } as const

export function LoadoutCodeList({
  codes,
  showStatus = false,
}: {
  codes: readonly LoadoutCode[]
  showStatus?: boolean
}) {
  return (
    <ul className={styles.grid}>
      {codes.map(code => (
        <li key={code.id} className={styles.card}>
          <header className={styles.head}>
            <span className={styles.weapon}>{code.weapon}</span>
            {showStatus ? (
              <span className={styles.status} data-status={code.status}>
                {STATUS[code.status]}
              </span>
            ) : code.authorHandle ? (
              <Link className={styles.author} href={`/players/${code.authorHandle}`}>
                {code.authorName}
              </Link>
            ) : (
              <span className={styles.author}>{code.authorName}</span>
            )}
          </header>
          <h3 className={styles.title}>{code.title}</h3>
          {code.note ? <p className={styles.note}>{code.note}</p> : null}
          <div className={styles.codeRow}>
            <code className={styles.code}>{code.code}</code>
            <CopyTextButton
              value={code.code}
              label={`复制「${code.title}」改枪码`}
              className={styles.copy}
            >
              复制
            </CopyTextButton>
          </div>
        </li>
      ))}
    </ul>
  )
}
