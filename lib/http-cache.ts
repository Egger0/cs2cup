export const PRIVATE_NO_STORE = 'private, no-cache, no-store, max-age=0, must-revalidate'

export const PRIVATE_NO_STORE_HEADERS = Object.freeze({
  'Cache-Control': PRIVATE_NO_STORE,
})

export function withPrivateNoStore<ResponseType extends Response>(response: ResponseType) {
  response.headers.set('Cache-Control', PRIVATE_NO_STORE)
  return response
}
