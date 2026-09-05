import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import styles from './HeaderSearch.module.css'

export function HeaderSearch({ hidden }: { hidden: boolean }) {
  return (
    <Link
      href="/search"
      aria-label="搜索赛事、战队和动态"
      title="全站搜索"
      className={styles.search}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      <Icon name="search" size={18} />
    </Link>
  )
}
