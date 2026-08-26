import Link from 'next/link'
import { Button, Empty, Field } from '@/components/ui'
import { adminListGames, adminListTournaments } from '@/lib/queries/content'
import { createTournament } from '../_actions'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

const STATE: Record<string, string> = {
  draft: '草稿',
  registration: '报名中',
  running: '进行中',
  finished: '已结束',
  postponed: '延期中',
}

export default async function AdminTournamentsPage() {
  const [tournaments, games] = await Promise.all([adminListTournaments(), adminListGames()])
  const gameName = (id: number | null) => games.find(game => game.id === id)?.name ?? '未关联'

  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>开一届新赛事</h2>
        <form className={styles.editor} action={createTournament}>
          <div className={styles.pair}>
            <Field id="nt-slug" name="slug" label="链接标识" required placeholder="例:2027-nlc" />
            <Field id="nt-title" name="title" label="赛事名称" required placeholder="例:第五届宁理杯" />
          </div>
          <div className={styles.pair}>
            <label className="readout">
              项目
              <select name="gameId" required className={styles.select}>
                {games.map(game => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            <Field id="nt-season" name="season" label="赛季" required placeholder="例:2027 春季" />
          </div>
          <div className={styles.pair}>
            <Field id="nt-edition" name="edition" type="number" min={1} label="第几届" required defaultValue={5} />
            <Field id="nt-cap" name="teamCap" type="number" min={2} label="席位数" required defaultValue={16} />
          </div>
          <Button type="submit" variant="primary">
            创建为草稿
          </Button>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>全部赛事 · {tournaments.length} 届</h2>
        {tournaments.length === 0 ? (
          <Empty>还没有赛事</Empty>
        ) : (
          <div className={styles.list}>
            {tournaments.map(tournament => (
              <div key={tournament.id} className={styles.listRow}>
                <div>
                  <div className={styles.listTitle}>{tournament.title}</div>
                  <div className={styles.listMeta}>
                    {gameName(tournament.gameId)} · {tournament.season} · 第 {tournament.edition} 届 ·{' '}
                    {tournament.teamCap} 队 · {STATE[tournament.status] ?? tournament.status}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <Link href={`/admin/tournaments/${tournament.id}`}>
                    <Button size="mini">编辑</Button>
                  </Link>
                  <Link href={`/tournaments/${tournament.slug}`}>
                    <Button size="mini">查看</Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
