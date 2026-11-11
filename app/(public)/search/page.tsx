import Link from 'next/link'
import { ButtonLink, Empty } from '@/components/ui'
import { Icon } from '@/components/ui/Icon'
import { PageMasthead } from '@/components/domain/Sections'
import { safely, search } from '@/lib/queries/public'
import styles from './search.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '搜索' }

const KIND: Record<string, string> = {
  game: '项目',
  tournament: '赛事',
  team: '战队',
  post: '动态',
  loadout: '改枪码',
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q = '' } = await searchParams
  const query = q.trim()
  const hits = query ? await safely(() => search(q), []) : []

  return (
    <>
      <PageMasthead
        tone="#8fc8ef"
        title="搜索"
        lede="赛事、战队、项目、社团动态和改枪码。"
        density="compact"
      />
      <section className="section">
        <div className="wrap">
          <form className={styles.form} action="/search" role="search">
            <Icon name="search" size={20} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="宁理杯、战队名或 M4A1"
              aria-label="搜索内容"
            />
            <button type="submit">搜索</button>
          </form>

          {query ? (
            <div className={styles.output}>
              <p className={styles.count} role="status">
                {hits.length > 0 ? `「${query}」共 ${hits.length} 条结果` : null}
              </p>
              {hits.length > 0 ? (
                <ol className={styles.results}>
                  {hits.map(hit => (
                    <li key={`${hit.kind}-${hit.href}`}>
                      <Link href={hit.href} className={styles.hit}>
                        <span className={styles.kind}>{KIND[hit.kind]}</span>
                        <span className={styles.identity}>
                          <span className={styles.title}>{hit.title}</span>
                          <span className={styles.subtitle}>{hit.subtitle}</span>
                        </span>
                        <Icon name="arrow" size={16} />
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty
                  action={
                    <>
                      <ButtonLink href="/tournaments" variant="primary">
                        浏览全部赛事
                      </ButtonLink>
                      <ButtonLink href="/news">查看社团动态</ButtonLink>
                    </>
                  }
                >
                  没有找到「{query}」。换个关键词试试。
                </Empty>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}
