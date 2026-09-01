import Link from 'next/link'
import { Empty, Field } from '@/components/ui'
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
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q = '' } = await searchParams
  const hits = q.trim() ? await safely(() => search(q), []) : []

  return (
    <section className="section">
      <div className="wrap">
        <PageMasthead
          eyebrow="搜索"
          title="找点什么"
          lede="赛事、战队、项目和动态都能搜。"
          density="compact"
        />

        <form className={styles.form} action="/search">
          <Field
            id="q"
            name="q"
            label="关键词"
            defaultValue={q}
            placeholder="例：宁理杯、FROST、纳新"
          />
          <button type="submit" className={styles.go}>
            <span>搜索</span>
            <span aria-hidden="true">→</span>
          </button>
        </form>

        {q.trim() ? (
          hits.length > 0 ? (
            <div className={styles.results}>
              {hits.map(hit => (
                <Link key={`${hit.kind}-${hit.href}`} href={hit.href} className={styles.hit}>
                  <span className={styles.kind}>{KIND[hit.kind]}</span>
                  <span>
                    <span className={styles.title}>{hit.title}</span>
                    <span className={styles.subtitle}>{hit.subtitle}</span>
                  </span>
                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>没有匹配「{q}」的内容</Empty>
          )
        ) : null}
      </div>
    </section>
  )
}
