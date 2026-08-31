import 'server-only'

import { requireAdmin } from '../../auth'

export async function adminMutation<Result>(write: () => Promise<Result>) {
  await requireAdmin()
  return write()
}
