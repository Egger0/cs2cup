import Link from 'next/link'
import { SectionHead } from '@/components/domain/Sections'
import { Empty } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import {
  loadoutLeaderboard,
  stardustLeaderboard,
  type LeaderboardRow,
} from '@/lib/queries/leaderboard'
import { safely } from '@/lib/queries/public'
import styles from './Leaderboards.module.css'

function Board({ rows, unit }: { rows: LeaderboardRow[]; unit: string }) {
  if (!rows.length) return <Empty>还没有人上榜。</Empty>
  return (
    <ol className={styles.board}>
      {rows.map((row, index) => (
        <li key={row.handle}>
          <span className={styles.rank}>{index + 1}</span>
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

export async function Leaderboards() {
  const database = cloudflareBindings().db
  const [stardust, loadouts] = await Promise.all([
    safely(() => stardustLeaderboard(database), []),
    safely(() => loadoutLeaderboard(database), []),
  ])
  return (
    <section className="section" id="leaderboard">
      <div className="wrap">
        <SectionHead title="排行榜" lede="只显示已公开个人主页的成员，每五分钟更新一次。" />
        <div className={styles.grid}>
          <section>
            <h3 className={styles.title}>星尘持有</h3>
            <Board rows={stardust} unit="星尘" />
          </section>
          <section>
            <h3 className={styles.title}>改枪码人气</h3>
            <Board rows={loadouts} unit="赞" />
          </section>
        </div>
      </div>
    </section>
  )
}
