import 'server-only'
import { selectPublicRows } from '../../rdb'
import type { GameRow, PostRow } from '../records'
import { listTournaments } from './tournaments'

export interface SearchHit {
  kind: 'tournament' | 'team' | 'post' | 'game'
  title: string
  subtitle: string
  href: string
}

export async function search(query: string): Promise<SearchHit[]> {
  const term = query.trim()
  if (term.length === 0) return []
  const like = `ilike.*${term}*`

  const [games, tournaments, posts] = await Promise.all([
    selectPublicRows<GameRow>('game', {
      filters: { or: `(name.${like},name_en.${like})` },
      limit: 8,
    }),
    selectPublicRows<{
      id: number
      slug: string
      title: string
      season: string
      edition: number
    }>('tournament_public', {
      filters: { or: `(title.${like},season.${like})` },
      limit: 8,
    }),
    selectPublicRows<PostRow>('post', {
      filters: { or: `(title.${like},summary.${like},body.${like})` },
      limit: 8,
    }),
  ])

  const allTournaments = await listTournaments()
  const teams = await selectPublicRows<{
    tournament_id: number
    name: string
    tag: string
  }>('team_public', {
    filters: { or: `(name.${like},tag.${like})` },
    limit: 10,
  })
  const teamHits = teams.flatMap<SearchHit>(team => {
    const tournament = allTournaments.find(entry => entry.id === team.tournament_id)
    return tournament
      ? [
          {
            kind: 'team',
            title: team.name,
            subtitle: `${team.tag} · ${tournament.title}`,
            href: `/tournaments/${tournament.slug}/teams/${team.tag}`,
          },
        ]
      : []
  })

  return [
    ...games.map(row => ({
      kind: 'game' as const,
      title: row.name,
      subtitle: row.name_en ?? '项目',
      href: `/games/${row.slug}`,
    })),
    ...tournaments.map(row => ({
      kind: 'tournament' as const,
      title: row.title,
      subtitle: `${row.season} · 第 ${row.edition} 届`,
      href: `/tournaments/${row.slug}`,
    })),
    ...teamHits,
    ...posts.map(row => ({
      kind: 'post' as const,
      title: row.title,
      subtitle: new Date(row.published_at).toLocaleDateString('zh-CN'),
      href: `/news/${row.slug}`,
    })),
  ]
}
