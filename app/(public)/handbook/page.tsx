import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { ButtonLink, Empty } from '@/components/ui'
import { HANDBOOK_KINDS, listHandbookDocuments, type HandbookKind } from '@/lib/handbook'
import { HANDBOOK_FILE_TYPES, formatFileSize, handbookFileType } from '@/lib/handbook-file'
import { safely } from '@/lib/queries/public'
import styles from './handbook.module.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '办赛文档',
  description: '宁波理工电竞社的赛事手册与办赛模板，给想自己牵头办一场比赛的社员。',
}

export default async function HandbookPage() {
  const documents = await safely(listHandbookDocuments, [])

  return (
    <>
      <PageMasthead
        code="HANDBOOK"
        tone="#9fb3bb"
        eyebrow="办赛文档"
        title="自己办一场比赛"
        lede="手册讲清一场比赛怎么办下来，模板可以直接拿去改。有想法就来牵头。"
        density="compact"
      >
        <ButtonLink href="/about#join" variant="primary">
          联系社团牵头办赛
        </ButtonLink>
      </PageMasthead>
      {documents.length === 0 ? (
        <section className="section">
          <div className="wrap">
            <Empty action={<ButtonLink href="/tournaments">先看看办过的赛事</ButtonLink>}>
              第一批手册和模板正在整理，整理好会放在这里。
            </Empty>
          </div>
        </section>
      ) : (
        (Object.keys(HANDBOOK_KINDS) as HandbookKind[]).map(kind => {
          const group = documents.filter(document => document.kind === kind)
          if (!group.length) return null
          return (
            <section className="section" key={kind}>
              <div className="wrap">
                <div data-rise>
                  <SectionHead
                    eyebrow={`${group.length} 份`}
                    title={HANDBOOK_KINDS[kind].label}
                    lede={HANDBOOK_KINDS[kind].lede}
                  />
                </div>
                <ul className={styles.list} data-rise="2">
                  {group.map((document, index) => {
                    const type = document.fileName ? handbookFileType(document.fileName) : null
                    const href = document.url ?? `/handbook/files/${document.id}`
                    return (
                      <li key={document.id}>
                        <a
                          className={styles.row}
                          href={href}
                          {...(document.url ? { target: '_blank', rel: 'noreferrer' } : {})}
                        >
                          <span className={styles.index} aria-hidden="true">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className={styles.copy}>
                            <strong>{document.title}</strong>
                            {document.summary ? <span>{document.summary}</span> : null}
                          </span>
                          <span className={styles.meta}>
                            {type
                              ? `${HANDBOOK_FILE_TYPES[type].label} · ${formatFileSize(document.byteSize ?? 0)}`
                              : new URL(href).hostname}
                          </span>
                          <span className={styles.action}>
                            {document.url ? '打开' : '下载'}
                            <span aria-hidden="true">{document.url ? ' ↗' : ' ↓'}</span>
                          </span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          )
        })
      )}
    </>
  )
}
