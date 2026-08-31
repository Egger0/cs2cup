import { Button, Empty, Field, TextField } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { adminListMembers } from '@/lib/queries/content'
import { createMember } from '../actions/content'
import { MemberEditor } from './MemberEditor'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminMembersPage() {
  await requireAdmin()

  const members = await adminListMembers()

  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>新增成员</h2>
        <form className={styles.editor} action={createMember}>
          <div className={styles.pair}>
            <Field id="new-member-name" name="name" label="姓名" required />
            <Field id="new-member-role" name="role" label="职务" required placeholder="例:社长" />
          </div>
          <div className={styles.pair}>
            <Field id="new-member-handle" name="handle" label="联系方式" />
            <Field
              id="new-member-order"
              name="sortOrder"
              label="显示顺序"
              type="number"
              defaultValue="0"
            />
          </div>
          <TextField id="new-member-intro" name="intro" label="职责" rows={2} />
          <Button type="submit" variant="primary">
            添加成员
          </Button>
        </form>
      </section>

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
    </>
  )
}
