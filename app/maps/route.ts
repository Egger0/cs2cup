import { redirectToGameFeature } from '@/lib/game-shortcut'

export const dynamic = 'force-dynamic'

export const GET = (request: Request) => redirectToGameFeature('maps', new URL(request.url).search)
