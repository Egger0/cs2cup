import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ButtonLink, Empty } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { getRegistrationStatus, getTournament, safely } from '@/lib/queries/public'
import { resolveSiteOrigin } from '@/lib/site-config'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import { getMembershipState } from '@/lib/identity/membership-service'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: '报名' }

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
  const context = await getAuthContext()
  const membership =
    context.kind === 'authenticated'
      ? await getMembershipState(cloudflareBindings().db, context)
      : null
  const eligible = membership?.ok === true && membership.membership?.status === 'approved'

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

        {accepting && context.kind === 'anonymous' ? (
          <Empty
            action={
              <>
                <ButtonLink
                  href={`/login?redirectKey=registration&tournamentSlug=${encodeURIComponent(slug)}`}
                  variant="primary"
                >
                  登录后报名
                </ButtonLink>
                <ButtonLink href="/register">创建账号</ButtonLink>
              </>
            }
          >
            赛事报名归属于账号。创建账号后可申请成员资格；等待期间仍可登录和维护资料。
          </Empty>
        ) : accepting && !eligible ? (
          <Empty
            action={
              <ButtonLink href="/account" variant="primary">
                查看或提交资格申请
              </ButtonLink>
            }
          >
            最终提交赛事报名需要已通过的成员资格。你的账号仍可正常使用。
          </Empty>
        ) : accepting ? (
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
