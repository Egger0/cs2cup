import Link from 'next/link'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { Empty } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { publicMetadata } from '@/lib/public-metadata'
import {
  loadoutLeaderboard,
  stardustLeaderboard,
  type LeaderboardRow,
} from '@/lib/queries/leaderboard'
import { safely } from '@/lib/queries/public'
import styles from './leaderboard.module.css'

export const revalidate = 300

export const metadata = publicMetadata(
  '排行榜',
  '星尘持有量和改枪码人气排行，只显示已公开主页的成员。',
  '/leaderboard',
)

function Board({ rows, unit }: { rows: LeaderboardRow[]; unit: string }) {
  if (!rows.length) return <Empty>还没有人上榜。</Empty>
  return (
    <ol className={styles.board}>
      {rows.map((row, index) => (
        <li key={row.handle}>
          <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
          <Link href={`/players/${row.handle}`}>{row.name}</Link>
          <span className={styles.score}>
            {row.score}
            <small>{unit}</small>
          </span>
        </li>
      ))}
    </ol>
  )
}

export default async function LeaderboardPage() {
  const database = cloudflareBindings().db
  const [stardust, loadouts] = await Promise.all([
    safely(() => stardustLeaderboard(database), []),
    safely(() => loadoutLeaderboard(database), []),
  ])

  return (
    <>
      <PageMasthead
        title="谁在发光"
        lede="只显示已公开个人主页的成员，每五分钟更新一次。"
        density="compact"
      />
      <div className="wrap">
        <div className={styles.grid}>
          <section>
            <SectionHead title="星尘持有榜" />
            <Board rows={stardust} unit="星尘" />
          </section>
          <section>
            <SectionHead title="改枪码人气榜" lede="按获得的点赞数排名，自己点赞不计。" />
            <Board rows={loadouts} unit="赞" />
          </section>
        </div>
      </div>
    </>
  )
}
