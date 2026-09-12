import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { Empty } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { publicMetadata } from '@/lib/public-metadata'
import { playerProfileByHandle } from '@/lib/queries/player-profile'
import styles from './player.module.css'

export const revalidate = 300

async function profileOf(handle: string) {
  return playerProfileByHandle(cloudflareBindings().db, decodeURIComponent(handle)).catch(
    () => null,
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  const profile = await profileOf(handle)
  if (!profile) return { title: '选手', robots: { index: false, follow: false } }
  return publicMetadata(
    profile.displayName,
    `${profile.displayName}在宁理电竞社的参赛记录。`,
    `/players/${profile.handle}`,
  )
}

export default async function PlayerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const profile = await profileOf(handle)
  if (!profile) notFound()

  return (
    <>
      <PageMasthead
        code="PLAYER"
        eyebrow={`PLAYER / ${profile.handle.toUpperCase()}`}
        title={profile.displayName}
        lede="这里记录参加过哪些赛事、代表哪支战队，不包含个人表现数据。"
      />
      <div className="wrap">
        <section className={styles.section}>
          <SectionHead eyebrow="履历" title="参赛记录" />
          {profile.entries.length > 0 ? (
            <ul className={styles.entries}>
              {profile.entries.map(entry => (
                <li key={`${entry.tournamentSlug}-${entry.teamTag}`} className={styles.entry}>
                  <div className={styles.entryMeta}>
                    <span className={styles.season}>{entry.season}</span>
                    <span className={styles.role}>{entry.isSubstitute ? '替补' : '首发'}</span>
                  </div>
                  <Link href={`/tournaments/${entry.tournamentSlug}`} className={styles.tournament}>
                    {entry.tournamentTitle}
                  </Link>
                  <Link
                    href={`/tournaments/${entry.tournamentSlug}/teams/${entry.teamTag}`}
                    className={styles.team}
                  >
                    {entry.teamName}
                    <span className={styles.tag}>{entry.teamTag}</span>
                  </Link>
                  <span className={styles.nickname}>{entry.nickname}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>还没有已认领的参赛记录</Empty>
          )}
        </section>
      </div>
    </>
  )
}
