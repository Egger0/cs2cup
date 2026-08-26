import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { getRegistrationStatus, getTournament } from '@/lib/queries/public'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const status = await getRegistrationStatus(slug)
  const seatsLeft = Math.max(0, status.cap - status.taken)
  const closed = !status.open || seatsLeft === 0

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow={closed ? '报名已关闭' : `还剩 ${seatsLeft} 个席位`}
            title="组队报名"
            lede="提交后由主办方审核。通过后战队会出现在参赛名单并进入对阵表。"
          />
        </div>
        <div data-rise="2">
          <RegisterForm slug={slug} disabled={closed} />
        </div>
      </div>
    </section>
  )
}
