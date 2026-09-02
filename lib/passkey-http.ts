import { NextResponse } from 'next/server'

import { withPrivateNoStore } from './http-cache'
export { PasskeyRequestError, readPasskeyJson } from './passkey-json.ts'

export function privateJson(body: unknown, init?: ResponseInit) {
  return withPrivateNoStore(NextResponse.json(body, init))
}

export function privateEmpty(status = 204) {
  return withPrivateNoStore(new NextResponse(null, { status }))
}

export function passkeyError(status = 400, message = '无法完成通行密钥操作，请重试。') {
  return privateJson({ error: message }, { status })
}
