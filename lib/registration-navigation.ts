const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/

export function registrationSlug(value: unknown): string | null {
  return typeof value === 'string' && SLUG_PATTERN.test(value) ? value : null
}

export function registrationAuthHref(route: 'login' | 'register' | 'recover', value?: unknown) {
  const slug = registrationSlug(value)
  if (!slug) return `/${route}`
  const query = new URLSearchParams({ tournamentSlug: slug })
  if (route === 'login') query.set('redirectKey', 'registration')
  return `/${route}?${query}`
}

export function registrationAccountHref(value?: unknown, welcome = false) {
  const query = new URLSearchParams()
  if (welcome) query.set('welcome', '1')
  const slug = registrationSlug(value)
  if (slug) query.set('tournamentSlug', slug)
  return `/account${query.size ? `?${query}` : ''}`
}

export function registrationDestination(value?: unknown) {
  const slug = registrationSlug(value)
  return slug ? `/tournaments/${slug}/register` : '/tournaments'
}
