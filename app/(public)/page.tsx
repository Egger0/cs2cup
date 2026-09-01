import { HomeEvidence } from '@/components/home/HomeEvidence'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeIndex } from '@/components/home/HomeIndex'
import { HomeReveal } from '@/components/home/HomeReveal'

export default function HomePage() {
  return (
    <>
      <HomeHero />
      <HomeReveal />
      <HomeEvidence />
      <HomeIndex />
    </>
  )
}
