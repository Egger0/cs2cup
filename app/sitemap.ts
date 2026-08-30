import type { MetadataRoute } from 'next'
import { listGames, listPosts, listTournaments, safely } from '@/lib/queries/public'
import { resolveSiteOrigin } from '@/lib/site-config'

const BASE = resolveSiteOrigin()

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [games, tournaments, posts] = await Promise.all([
    safely(listGames, []),
    safely(listTournaments, []),
    safely(() => listPosts(), []),
  ])

  const now = new Date()

  return [
    { url: BASE, lastModified: now, priority: 1 },
    { url: `${BASE}/games`, lastModified: now, priority: 0.8 },
    { url: `${BASE}/tournaments`, lastModified: now, priority: 0.8 },
    { url: `${BASE}/archive`, lastModified: now, priority: 0.6 },
    { url: `${BASE}/news`, lastModified: now, priority: 0.7 },
    { url: `${BASE}/about`, lastModified: now, priority: 0.6 },
    { url: `${BASE}/guestbook`, lastModified: now, priority: 0.5 },
    ...games.map(game => ({ url: `${BASE}/games/${game.slug}`, lastModified: now, priority: 0.7 })),
    ...tournaments.flatMap(tournament => {
      const base = `${BASE}/tournaments/${tournament.slug}`
      return ['', '/schedule', '/teams', '/bracket', '/results', '/rules'].map(suffix => ({
        url: `${base}${suffix}`,
        lastModified: now,
        priority: suffix === '' ? 0.9 : 0.5,
      }))
    }),
    ...posts.map(post => ({
      url: `${BASE}/news/${post.slug}`,
      lastModified: new Date(post.publishedAt),
      priority: 0.5,
    })),
  ]
}
