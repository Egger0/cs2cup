import { PageMasthead } from '@/components/domain/Sections'
import { PostList } from '@/components/domain/PostList'
import { Empty } from '@/components/ui'
import { listPosts, safely } from '@/lib/queries/public'

export const revalidate = 300

export const metadata = { title: '动态' }

export default async function NewsPage() {
  const posts = await safely(() => listPosts(), [])

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <PageMasthead
            eyebrow="社团动态"
            title="公告与记录"
            lede="赛事通知、纳新、服务器变更都在这里。"
            density="compact"
          />
        </div>
        {posts.length > 0 ? <PostList posts={posts} /> : <Empty>还没有发布动态</Empty>}
      </div>
    </section>
  )
}
