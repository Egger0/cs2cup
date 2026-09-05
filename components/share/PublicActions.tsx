import { ShareButton } from './ShareButton'
import { Icon } from '@/components/ui/Icon'
import type { PublicShare } from '@/lib/share-poster'
import styles from './PublicActions.module.css'

export function PublicActions({
  share,
  label,
  calendar,
}: {
  share: PublicShare
  label: string
  calendar?: { href: string; label: string }
}) {
  return (
    <div className={styles.actions}>
      <ShareButton share={share}>{label}</ShareButton>
      {calendar ? (
        <a href={calendar.href} download>
          <Icon name="calendar" size={16} />
          {calendar.label}
        </a>
      ) : null}
      <span>叫上队友，下一场见。</span>
    </div>
  )
}
