import { SectionHead } from '@/components/domain/Sections'

export function AdminPageHeader({ title, description }: { title: string; description: string }) {
  return <SectionHead title={title} lede={description} />
}
