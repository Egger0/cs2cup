import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageMasthead } from '@/components/domain/Sections'
import { ButtonLink, Empty } from '@/components/ui'
import { CopyTextButton } from '@/components/ui/CopyTextButton'
import { listGraphicsPresets } from '@/lib/graphics-presets'
import { graphicsSettingGroups } from '@/lib/graphics-settings'
import { PLANET_COLORS } from '@/lib/planets'
import { getGame, safely } from '@/lib/queries/public'
import styles from './graphics.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const game = await safely(async () => getGame((await params).slug), null)
  return {
    title: game ? `${game.name} 画质方案` : '画质方案',
    description: game ? `社员调校好的${game.name}画质设置，按配置挑一套照着改。` : undefined,
  }
}

export default async function GraphicsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const game = await getGame(slug)
  if (!game) notFound()
  const presets = await safely(() => listGraphicsPresets(game.id), [])

  return (
    <>
      <PageMasthead
        code="GRAPHICS"
        tone={PLANET_COLORS.get(game.slug)}
        eyebrow={`${game.name} / 画质方案`}
        title="画质方案"
        lede="社员调校好的画质设置。按自己的配置挑一套，进游戏照着逐项改。"
        density="compact"
      >
        <ButtonLink href={`/games/${game.slug}`}>回到{game.name}</ButtonLink>
      </PageMasthead>
      <section className="section">
        <div className="wrap">
          {presets.length === 0 ? (
            <Empty action={<ButtonLink href="/about#join">把你的设置发给社团</ButtonLink>}>
              这个项目还没有画质方案。
            </Empty>
          ) : (
            <div className={styles.presets}>
              {presets.map((preset, index) => (
                <article key={preset.id} className={styles.preset} data-rise>
                  <header className={styles.head}>
                    <span className={styles.index} aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className={styles.heading}>
                      <h2>{preset.title}</h2>
                      <p className={styles.facts}>
                        <span>{preset.hardware}</span>
                        {preset.target ? <span>{preset.target}</span> : null}
                        {preset.author ? <span>来自 {preset.author}</span> : null}
                      </p>
                    </div>
                    <CopyTextButton value={preset.settings} label={`复制${preset.title}的设置清单`}>
                      复制清单
                    </CopyTextButton>
                  </header>
                  {preset.note ? <p className={styles.note}>{preset.note}</p> : null}
                  {graphicsSettingGroups(preset.settings).map(group => (
                    <section key={group.name} className={styles.group}>
                      {group.name ? <h3>{group.name}</h3> : null}
                      <dl>
                        {group.items.map(([name, value]) => (
                          <div key={name}>
                            <dt>{name}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
