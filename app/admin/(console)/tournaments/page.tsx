import { ButtonLink, Empty, Field } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { canCreateTournamentForGame, requirePlatformConsole } from '@/lib/auth'
import { adminListGames, adminListTournaments } from '@/lib/queries/content'
import { listTournamentRecordsForGames } from '@/lib/queries/content/tournaments'
import { listGames } from '@/lib/queries/public/games'
import { TOURNAMENT_FORM_LIMITS } from '@/lib/tournament-form-validation'
import { TournamentCreateForm } from './TournamentCreateForm'
import { TournamentDeleteButton } from './TournamentDeleteButton'
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
  const access = await requirePlatformConsole()
  const isPlatformOwner = access.capabilities.includes('platform.configure')
  const games = isPlatformOwner ? await adminListGames() : await listGames()
  const allowedGameIds = new Set(
    (
      await Promise.all(
        games.map(async game => ((await canCreateTournamentForGame(game.id)) ? game.id : null)),
      )
    ).filter((id): id is number => id !== null),
  )
  if (!isPlatformOwner && !allowedGameIds.size) return null
  const visibleGames = games.filter(game => allowedGameIds.has(game.id))
  const visibleTournaments = isPlatformOwner
    ? (await adminListTournaments()).filter(
        tournament => tournament.gameId !== null && allowedGameIds.has(tournament.gameId),
      )
    : await listTournamentRecordsForGames([...allowedGameIds])
  const gameName = (id: number | null) => games.find(game => game.id === id)?.name ?? '未关联'

  return (
    <>
      <AdminPageHeader
        index="03"
        title="赛事档案"
        description="创建赛季、调整公开状态，并进入每届赛事的赛程工作台。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>开一届新赛事</h2>
        <TournamentCreateForm>
          <div className={styles.pair}>
            <Field
              id="nt-slug"
              name="slug"
              label="链接标识"
              required
              maxLength={TOURNAMENT_FORM_LIMITS.slug}
              pattern="[a-z0-9](?:[a-z0-9]|-){0,99}"
              hint="小写字母、数字和连字符"
              placeholder="例:2027-nlc"
            />
            <Field
              id="nt-title"
              name="title"
              label="赛事名称"
              required
              maxLength={TOURNAMENT_FORM_LIMITS.title}
              placeholder="例:第五届宁理杯"
            />
          </div>
          <div className={styles.pair}>
            <label className={styles.controlLabel}>
              项目
              <select name="gameId" required className={styles.select}>
                {visibleGames.map(game => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              id="nt-season"
              name="season"
              label="赛季"
              required
              maxLength={TOURNAMENT_FORM_LIMITS.season}
              placeholder="例:2027 春季"
            />
          </div>
          <div className={styles.pair}>
            <Field
              id="nt-edition"
              name="edition"
              type="number"
              min={1}
              step={1}
              label="第几届"
              required
              defaultValue={5}
            />
            <Field
              id="nt-cap"
              name="teamCap"
              type="number"
              min={2}
              max={TOURNAMENT_FORM_LIMITS.teamCap}
              step={1}
              label="席位数"
              required
              defaultValue={16}
            />
          </div>
        </TournamentCreateForm>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>全部赛事 · {visibleTournaments.length} 届</h2>
        {visibleTournaments.length === 0 ? (
          <Empty>还没有赛事</Empty>
        ) : (
          <div className={styles.list}>
            {visibleTournaments.map(tournament => (
              <div key={tournament.id} className={styles.listRow}>
                <div>
                  <div className={styles.listTitle}>{tournament.title}</div>
                  <div className={styles.listMeta}>
                    {gameName(tournament.gameId)} · {tournament.season} · 第 {tournament.edition} 届
                    · {tournament.teamCap} 队 · {STATE[tournament.status] ?? tournament.status}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <ButtonLink href={`/admin/tournaments/${tournament.id}`} size="mini">
                    编辑
                  </ButtonLink>
                  <ButtonLink href={`/tournaments/${tournament.slug}`} size="mini">
                    查看
                  </ButtonLink>
                  {isPlatformOwner ? (
                    <TournamentDeleteButton id={tournament.id} title={tournament.title} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
