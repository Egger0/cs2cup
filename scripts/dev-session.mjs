import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createServer } from 'node:http'
import { chmodSync, writeFileSync } from 'node:fs'

const ISSUER = process.env.DEV_ISSUER ?? 'http://localhost:53100'
const AUD = process.env.DEV_AUD ?? 'dev-env'
const SUB = process.env.DEV_SUB ?? 'local-dev-admin'
const PORT = Number(new URL(ISSUER).port)

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
const jwk = await exportJWK(publicKey)
jwk.kid = 'dev'
jwk.alg = 'RS256'
jwk.use = 'sig'

createServer((request, response) => {
  const send = (body) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.url === '/.well-known/openid-configuration') {
    return send({ issuer: ISSUER, jwks_uri: `${ISSUER}/certs` })
  }
  if (request.url === '/certs') return send({ keys: [jwk] })
  response.writeHead(404)
  response.end()
}).listen(PORT, () => console.error(`dev issuer on ${ISSUER}`))

const token = await new SignJWT({ sub: SUB, aud: AUD })
  .setProtectedHeader({ alg: 'RS256', kid: 'dev' })
  .setIssuer(ISSUER)
  .setAudience(AUD)
  .setExpirationTime('8h')
  .sign(privateKey)

const tokenFile = process.env.DEV_TOKEN_FILE
if (tokenFile) {
  writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 })
  chmodSync(tokenFile, 0o600)
  console.error(`dev token written to ${tokenFile}`)
} else {
  console.log(token)
}
