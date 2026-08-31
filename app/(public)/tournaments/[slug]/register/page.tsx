import { notFound } from 'next/navigation'
import { ButtonLink, Empty } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { getRegistrationStatus, getTournament, safely } from '@/lib/queries/public'
import { resolveSiteOrigin } from '@/lib/site-config'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const status = await safely(() => getRegistrationStatus(slug), {
    cap: tournament.teamCap,
    taken: 0,
    open: false,
  })
  const seatsLeft = Math.max(0, status.cap - status.taken)
  const accepting = status.open && seatsLeft > 0

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow={accepting ? `还剩 ${seatsLeft} / ${status.cap} 个席位` : '报名已截止'}
            title="组队报名"
            lede={
              accepting ? '提交后由主办方审核。通过的战队会出现在参赛名单并进入对阵表。' : undefined
            }
          />
        </div>

        {accepting ? (
          <div data-rise="2">
            <RegisterForm slug={slug} disabled={false} siteOrigin={resolveSiteOrigin()} />
          </div>
        ) : (
          <Empty
            action={
              <>
                <ButtonLink href={`/tournaments/${slug}/teams`} variant="primary">
                  看看谁报了名
                </ButtonLink>
                <ButtonLink href="/about">进群等下一届</ButtonLink>
              </>
            }
          >
            {status.open
              ? `${status.cap} 个席位已经报满了。下一届开放报名时会在社团动态里通知。`
              : '本届赛事不再接受报名。'}
          </Empty>
        )}
      </div>
    </section>
  )
}
