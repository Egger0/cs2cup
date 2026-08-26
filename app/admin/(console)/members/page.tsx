import { Empty } from '@/components/ui'
import { adminListMembers } from '@/lib/queries/content'
import { MemberEditor } from './MemberEditor'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminMembersPage() {
  const members = await adminListMembers()

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelHead}>核心团队 · {members.length} 人</h2>
      {members.length === 0 ? (
        <Empty>还没有登记成员</Empty>
      ) : (
        <div className={styles.list}>
          {members.map(member => (
            <MemberEditor key={member.id} member={member} />
          ))}
        </div>
      )}
    </section>
  )
}
