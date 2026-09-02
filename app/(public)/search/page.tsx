import Link from 'next/link'
import { ButtonLink, Empty, Field } from '@/components/ui'
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

const SOURCES = ['赛事', '战队', '项目', '动态']

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q = '' } = await searchParams
  const query = q.trim()
  const hits = query ? await safely(() => search(q), []) : []
  const resultCode = String(hits.length).padStart(2, '0')

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <PageMasthead
            eyebrow="NINGLI INDEX / 全站检索"
            title="找点什么"
            lede="从赛事、战队、项目和社团动态里，调取你要找的那一条记录。"
            density="compact"
          />
        </div>

        <div className={styles.console}>
          <span className={styles.serial} aria-hidden="true">
            07
          </span>
          <div className={styles.consoleHead} aria-hidden="true">
            <span>NINGLI ESPORTS / PUBLIC INDEX</span>
            <span>{query ? `QUERY ACTIVE / ${resultCode}` : 'SYSTEM READY / 04 SOURCES'}</span>
          </div>

          <form className={styles.form} action="/search">
            <span className={styles.prompt} aria-hidden="true">
              Q/
            </span>
            <Field
              id="q"
              name="q"
              label="检索词"
              defaultValue={q}
              placeholder="宁理杯 / FROST / 纳新"
            />
            <button type="submit" className={styles.go}>
              <span>执行检索</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <div className={styles.sources} aria-hidden="true">
            <span className={styles.sourceLead}>INDEX</span>
            {SOURCES.map((source, index) => (
              <span key={source}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                {source}
              </span>
            ))}
          </div>
        </div>

        {query ? (
          <div className={styles.output} data-rise="3">
            <div className={styles.outputHead}>
              <span>
                {hits.length > 0 ? 'RESULT' : 'NO MATCH'} / {resultCode}
              </span>
              <span>QUERY “{query}”</span>
            </div>

            {hits.length > 0 ? (
              <ol className={styles.results}>
                {hits.map((hit, index) => (
                  <li key={`${hit.kind}-${hit.href}`} className={styles.resultItem}>
                    <Link href={hit.href} className={styles.hit}>
                      <span className={styles.index} aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className={styles.kind}>{KIND[hit.kind]}</span>
                      <span className={styles.identity}>
                        <span className={styles.title}>{hit.title}</span>
                        <span className={styles.subtitle}>{hit.subtitle}</span>
                      </span>
                      <span className={styles.arrow} aria-hidden="true">
                        →
                      </span>
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
                没有匹配「{query}」的记录。可以修改检索词，或从完整目录继续找。
              </Empty>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
