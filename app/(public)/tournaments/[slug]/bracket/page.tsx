import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Bracket } from '@/components/domain/Bracket'
import { SectionHead } from '@/components/domain/Sections'
import { winsNeeded } from '@/lib/bracket'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'
import styles from './groups.module.css'

export const revalidate = 300
export const metadata: Metadata = { title: '对阵表' }

const DELTA_GROUPS = [
  {
    label: '第一组',
    date: '2026-10-03',
    dateLabel: '10 月 3 日',
    teams: ['菜鸡见世面', '天王星队', '煞', '三赫兹'],
  },
  {
    label: '第二组',
    date: '2026-10-04',
    dateLabel: '10 月 4 日',
    teams: ['温州之光', '宁理之星', '也够小队', '无敌暴龙战士'],
  },
] as const

function formatRoundStructure(matches: Awaited<ReturnType<typeof getMatches>>) {
  const rounds = new Map<number, { label: string; bestOf: number }>()
  for (const match of matches) {
    if (!rounds.has(match.round)) {
      rounds.set(match.round, { label: match.roundLabel, bestOf: match.bestOf })
    }
  }

  const formats = [...rounds.entries()].sort(([a], [b]) => a - b).map(([, round]) => round)
  const first = formats[0]
  if (!first) return '具体局制将在抽签后公布。'

  const sameBestOf = formats.every(round => round.bestOf === first.bestOf)
  if (sameBestOf) {
    const bestOf = first.bestOf
    return `全部轮次均为 BO${bestOf}，先赢 ${winsNeeded(bestOf)} 张图晋级。`
  }

  return `各轮局制：${formats.map(round => `${round.label} BO${round.bestOf}`).join('、')}。`
}

export default async function BracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  if (slug === '2026-df') {
    return (
      <section className="section">
        <div className="wrap">
          <div data-rise>
            <SectionHead
              eyebrow="小组积分赛"
              title="对阵表"
              lede="八支战队分为两组，每组四支。按队伍积分排名，每组前三名晋级决赛。"
            />
          </div>
          <div className={styles.grid} data-rise="2">
            {DELTA_GROUPS.map(group => (
              <section className={styles.card} key={group.date}>
                <div className={styles.cardHead}>
                  <h3 className={styles.label}>{group.label} · 四进三</h3>
                  <time dateTime={group.date} className={styles.date}>
                    {group.dateLabel}
                  </time>
                </div>
                <ul className={styles.teams}>
                  {group.teams.map(team => (
                    <li key={team}>{team}</li>
                  ))}
                </ul>
                <p className={styles.note}>按队伍积分排名，前三名晋级</p>
              </section>
            ))}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h3 className={styles.label}>决赛</h3>
                <time dateTime="2026-10-05" className={styles.date}>
                  10 月 5 日
                </time>
              </div>
              <p className={styles.finalTeams}>决赛队伍待定</p>
              <p className={styles.note}>达到赛点的队伍并在赛点破译曼德尔砖，即为冠军。</p>
            </section>
          </div>
        </div>
      </section>
    )
  }

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const structure = formatRoundStructure(matches)

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow="单败淘汰"
            title="对阵表"
            lede={`输一场即出局。${structure}点开任意一场查看 Ban/Pick。`}
          />
        </div>
        <div data-rise="2">
          <Bracket
            matches={matches}
            teams={teams}
            slug={slug}
            cap={tournament.teamCap}
            finished={tournament.status === 'finished'}
          />
        </div>
      </div>
    </section>
  )
}
