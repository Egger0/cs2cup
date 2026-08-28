import { Button, Empty, Field, TextField } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { adminListGames, adminListPosts } from '@/lib/queries/content'
import { createPost } from '../_actions'
import { PostEditor } from './PostEditor'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminPostsPage() {
  await requireAdmin()

  const [posts, games] = await Promise.all([adminListPosts(), adminListGames()])

  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>发布动态</h2>
        <form className={styles.editor} action={createPost}>
          <div className={styles.pair}>
            <Field id="np-slug" name="slug" label="链接标识" required placeholder="例:recruit-2026" />
            <Field id="np-title" name="title" label="标题" required />
          </div>
          <Field id="np-summary" name="summary" label="摘要" required />
          <TextField id="np-body" name="body" label="正文" rows={5} required />
          <div className={styles.pair}>
            <label className="readout">
              关联项目
              <select name="gameId" defaultValue="" className={styles.select}>
                <option value="">不关联</option>
                {games.map(game => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="readout">
              <input type="checkbox" name="pinned" /> 置顶
            </label>
          </div>
          <Button type="submit" variant="primary">
            发布
          </Button>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>已发布 · {posts.length} 条</h2>
        {posts.length === 0 ? (
          <Empty>还没有动态</Empty>
        ) : (
          <div className={styles.list}>
            {posts.map(post => (
              <PostEditor key={post.id} post={post} games={games} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}
