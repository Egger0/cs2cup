import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createServer } from 'node:http'
import { chmodSync, writeFileSync } from 'node:fs'

const ISSUER = process.env.DEV_ISSUER ?? 'http://localhost:53100'
const AUD = process.env.DEV_AUD ?? 'dev-env'
const SUB = process.env.DEV_SUB ?? 'local-dev-admin'
const NON_ADMIN_SUB = process.env.DEV_NON_ADMIN_SUB ?? 'local-dev-non-admin'
const issuerUrl = new URL(ISSUER)
const PORT = Number(issuerUrl.port)
const HOST = process.env.DEV_HOST ?? issuerUrl.hostname

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('DEV_ISSUER must include a valid TCP port')
}

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
}).listen(PORT, HOST, () => console.error(`dev issuer on ${ISSUER}`))

const signToken = sub =>
  new SignJWT({ sub, aud: AUD })
    .setProtectedHeader({ alg: 'RS256', kid: 'dev' })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setExpirationTime('8h')
    .sign(privateKey)

const [token, nonAdminToken] = await Promise.all([signToken(SUB), signToken(NON_ADMIN_SUB)])

const tokenFile = process.env.DEV_TOKEN_FILE
if (tokenFile) {
  writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 })
  chmodSync(tokenFile, 0o600)
  console.error(`dev token written to ${tokenFile}`)

  const nonAdminTokenFile = process.env.DEV_NON_ADMIN_TOKEN_FILE ?? `${tokenFile}.non-admin`
  writeFileSync(nonAdminTokenFile, nonAdminToken, { encoding: 'utf8', mode: 0o600 })
  chmodSync(nonAdminTokenFile, 0o600)
  console.error(`non-admin dev token written to ${nonAdminTokenFile}`)
} else {
  console.log(token)
}
