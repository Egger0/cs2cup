import { SectionHead } from '@/components/domain/Sections'

export function AdminPageHeader({
  index,
  title,
  description,
}: {
  index: string
  title: string
  description: string
}) {
  return <SectionHead eyebrow={`CONTROL / ${index}`} title={title} lede={description} />
}
