import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SandTable } from '@/components/delta-map/SandTable'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { ButtonLink } from '@/components/ui'
import { DELTA_MAPS, deltaMap } from '@/lib/delta-maps'
import { PLANET_COLORS } from '@/lib/planets'
import { getGame, safely } from '@/lib/queries/public'
import { canManageSandRoutes } from '@/lib/project-content-access'
import { findSandPlan, listSandPlans } from '@/lib/sand-route-store'
import theme from '@/app/site-theme.module.css'
import styles from './maps.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ map?: string }>
}): Promise<Metadata> {
  const [game, { map }] = await Promise.all([
    getGame((await params).slug).catch(() => null),
    searchParams,
  ])
  const current = deltaMap(map)
  return {
    title: game ? `${current.name} · ${game.name} 战术沙盘` : '战术沙盘',
    description: `${current.name}的立体沙盘：区域、撤离点与撤离条件、首领、钥匙房一图看清。`,
  }
}

export default async function MapsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ map?: string; plan?: string }>
}) {
  const [{ slug }, { map, plan }] = await Promise.all([params, searchParams])
  const game = await getGame(slug)
  if (!game?.loadoutCodes) notFound()
  const [approved, linked] = await Promise.all([
    safely(() => listSandPlans('approved'), []),
    safely(async () => (Number(plan) > 0 ? findSandPlan(Number(plan)) : null), null),
  ])
  const shared =
    linked && (linked.approved || (await safely(canManageSandRoutes, false))) ? linked : null
  const plans = shared && !shared.approved ? [shared, ...approved] : approved
  const loadouts = `/games/${game.slug}/loadouts`

  return (
    <>
      <PageMasthead
        code="SANDTABLE"
        tone={PLANET_COLORS.get(game.slug)}
        eyebrow={`${game.name} / 烽火地带`}
        title="战术沙盘"
        lede="六张烽火地带地图摆上桌：楼层逐层拆开看，钥匙房、保险箱、撤离条件一搜就到，跑刀路线逐站写上思路，投稿给全社用。"
        density="compact"
      >
        <ButtonLink href="#sandtable" variant="primary">
          展开沙盘
        </ButtonLink>
        <ButtonLink href={loadouts}>改枪码</ButtonLink>
      </PageMasthead>

      <section className={`${theme.dark} ${styles.stage}`} id="sandtable">
        <SandTable
          maps={DELTA_MAPS}
          initial={deltaMap(shared?.mapId ?? map).id}
          loadouts={loadouts}
          plans={plans}
          shared={shared}
        />
      </section>

      <section className="section" id="extracts">
        <div className="wrap">
          <div data-rise>
            <SectionHead
              eyebrow="EXTRACTS · 撤离速查"
              title="每张图怎么走"
              lede="各难度的撤离点与条件。版本更新后以游戏内为准。"
            />
          </div>
          <div className={styles.dossier}>
            {DELTA_MAPS.map(entry => (
              <article key={entry.id} className={styles.card}>
                <header>
                  <h3>{entry.name}</h3>
                  <span>{entry.en}</span>
                </header>
                <p className={styles.regions}>{entry.areas}</p>
                {entry.bosses ? <p className={styles.boss}>首领 {entry.bosses}</p> : null}
                <ul className={styles.exits}>
                  {entry.exits.map(([label, note, only], index) => (
                    <li key={index}>
                      {label}
                      {note ? <small>{note}</small> : null}
                      {only ? <em>仅{only}</em> : null}
                    </li>
                  ))}
                </ul>
                <ButtonLink href={`?map=${entry.id}#sandtable`} size="mini">
                  在沙盘里看 <span aria-hidden="true">→</span>
                </ButtonLink>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
