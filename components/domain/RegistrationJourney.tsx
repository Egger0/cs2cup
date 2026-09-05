import Link from 'next/link'
import {
  registrationAccountHref,
  registrationDestination,
  registrationSlug,
} from '@/lib/registration-navigation'
import styles from './RegistrationJourney.module.css'

export function RegistrationJourney({
  slug,
  accountReady = false,
  membershipReady = false,
}: {
  slug: string
  accountReady?: boolean
  membershipReady?: boolean
}) {
  if (!registrationSlug(slug)) return null
  return (
    <aside className={styles.journey} aria-label="赛事报名进度">
      <p>继续这次赛事报名</p>
      <ol>
        <li aria-current={!accountReady ? 'step' : undefined}>1 · 登录或创建账号</li>
        <li aria-current={accountReady && !membershipReady ? 'step' : undefined}>
          2 · 确认成员资格
        </li>
        <li aria-current={membershipReady ? 'step' : undefined}>3 · 填写战队报名</li>
      </ol>
      {accountReady ? (
        <div className={styles.actions}>
          <Link href={`${registrationAccountHref(slug)}#membership`}>查看资格状态</Link>
          <Link href={registrationDestination(slug)}>继续填写报名 →</Link>
          <span>
            {membershipReady
              ? '成员资格已通过，可以继续报名。'
              : '资格审核期间也可以保存报名草稿。'}
          </span>
        </div>
      ) : (
        <Link href={registrationDestination(slug)}>返回赛事报名 →</Link>
      )}
    </aside>
  )
}
