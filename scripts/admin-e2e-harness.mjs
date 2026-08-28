import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  constants as fsConstants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { packStandalone } from './pack-standalone.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}_${randomBytes(6).toString('hex')}`
const dnsSuffix = suffix.replaceAll('_', '-')
const database = `cs2cup_e2e_${suffix}`
const publicContainer = `cs2cup-e2e-public-${dnsSuffix}`
const adminContainer = `cs2cup-e2e-admin-${dnsSuffix}`
const tempRoot = mkdtempSync(join(tmpdir(), 'cs2cup-admin-e2e-harness-'))
const appRoot = join(tempRoot, 'app')
const photoRoot = join(tempRoot, 'photos')
const tokenFile = join(tempRoot, 'admin.token')
const nonAdminTokenFile = join(tempRoot, 'non-admin.token')
const adminSubject = `admin-e2e-${suffix}`
const nonAdminSubject = `non-admin-e2e-${suffix}`
const audience = `dev-e2e-${dnsSuffix}`
const legacyPublicPhotoKey = '2025-nlc/11.jpg'

if (!/^cs2cup_e2e_[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('Generated E2E database name is unsafe')
}
if (
  !/^cs2cup-e2e-(?:public|admin)-[a-zA-Z0-9-]+$/.test(publicContainer) ||
  !/^cs2cup-e2e-(?:public|admin)-[a-zA-Z0-9-]+$/.test(adminContainer)
) {
  throw new Error('Generated E2E container name is unsafe')
}
if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(audience)) {
  throw new Error('Generated E2E audience is not a safe CloudBase environment ID')
}

const abortController = new AbortController()
const signalHandlers = new Map()
for (const signalName of ['SIGINT', 'SIGTERM']) {
  const handler = () => abortController.abort(new Error(`Interrupted by ${signalName}`))
  signalHandlers.set(signalName, handler)
  process.once(signalName, handler)
}

function childEnvironment(extra = {}) {
  const allowed = [
    'PATH',
    'HOME',
    'USER',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'TERM',
    'CI',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'COMPOSE_PROJECT_NAME',
    'XDG_CONFIG_HOME',
    'PLAYWRIGHT_BROWSERS_PATH',
  ]
  const environment = {}
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment[name] = process.env[name]
  }
  return { ...environment, ...extra }
}

function commandFailure(label, result) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return new Error(`${label} failed${output ? `\n${output}` : ''}`)
}

function runSync(label, command, args, options = {}) {
  if (!options.ignoreAbort) abortController.signal.throwIfAborted()
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw commandFailure(label, result)
  if (options.print !== false) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }
  return result.stdout.trim()
}

function docker(args, options = {}) {
  return runSync('docker', 'docker', args, options)
}

function psql(targetDatabase, sql, { quiet = true, ignoreAbort = false } = {}) {
  return docker(
    [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      targetDatabase,
      '-v',
      'ON_ERROR_STOP=1',
      ...(quiet ? ['-q'] : []),
      '-f',
      '-',
    ],
    { input: sql, print: !quiet, ignoreAbort },
  )
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function freePort(usedPorts) {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer()
      server.unref()
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        const address = server.address()
        const selected = typeof address === 'object' && address ? address.port : 0
        server.close(error => (error ? reject(error) : resolve(selected)))
      })
    })
    if (port > 0 && !usedPorts.has(port)) {
      usedPorts.add(port)
      return port
    }
  }
}

function appendLog(service, chunk) {
  const text = chunk.toString()
  service.logs = `${service.logs}${text}`.slice(-32_768)
  process.stdout.write(`[${service.label}] ${text}`)
}

async function startProcess(label, command, args, options) {
  abortController.signal.throwIfAborted()
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const service = { label, child, logs: '' }
  child.stdout.on('data', chunk => appendLog(service, chunk))
  child.stderr.on('data', chunk => appendLog(service, chunk))

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  return service
}

function processRunning(service) {
  return service.child.exitCode === null && service.child.signalCode === null
}

function signalProcessGroup(service, signalName) {
  if (!service.child.pid || !processRunning(service)) return
  try {
    process.kill(-service.child.pid, signalName)
  } catch {
    try {
      service.child.kill(signalName)
    } catch {
      // The exact process already exited.
    }
  }
}

async function stopProcess(service) {
  if (!service || !processRunning(service)) return
  signalProcessGroup(service, 'SIGTERM')
  const exited = await Promise.race([
    new Promise(resolve => service.child.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && processRunning(service)) {
    signalProcessGroup(service, 'SIGKILL')
    await new Promise(resolve => service.child.once('exit', resolve))
  }
}

async function runProcess(label, command, args, options) {
  const service = await startProcess(label, command, args, options)
  const onAbort = () => signalProcessGroup(service, 'SIGTERM')
  abortController.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = processRunning(service)
      ? await new Promise((resolve, reject) => {
          service.child.once('error', reject)
          service.child.once('exit', (code, signalName) => resolve({ code, signalName }))
        })
      : { code: service.child.exitCode, signalName: service.child.signalCode }
    abortController.signal.throwIfAborted()
    if (result.code !== 0) {
      throw new Error(
        `${label} exited with ${result.code ?? result.signalName ?? 'unknown status'}\n${service.logs}`,
      )
    }
  } finally {
    abortController.signal.removeEventListener('abort', onAbort)
    await stopProcess(service)
  }
}

async function waitForHttp(url, label, service, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    abortController.signal.throwIfAborted()
    if (service && !processRunning(service)) {
      throw new Error(`${label} exited before becoming ready\n${service.logs}`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.status < 500) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error.message
    }
    await delay(250, undefined, { signal: abortController.signal })
  }
  throw new Error(`${label} did not become ready: ${lastError}`)
}

async function waitForFiles(paths, service, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    abortController.signal.throwIfAborted()
    if (!processRunning(service)) {
      throw new Error(`${service.label} exited before writing tokens\n${service.logs}`)
    }
    if (paths.every(path => existsSync(path))) return
    await delay(100, undefined, { signal: abortController.signal })
  }
  throw new Error(`${service.label} did not write its token files`)
}

function copyApplication() {
  mkdirSync(appRoot, { recursive: true })
  const directories = ['app', 'components', 'lib', 'public']
  const files = [
    'next.config.ts',
    'package-lock.json',
    'package.json',
    'proxy.ts',
    'THIRD_PARTY_NOTICES.md',
    'tsconfig.json',
  ]
  for (const directory of directories) {
    cpSync(join(ROOT, directory), join(appRoot, directory), {
      recursive: true,
      filter: source => source !== join(ROOT, 'public', 'photos'),
    })
  }
  for (const file of files) cpSync(join(ROOT, file), join(appRoot, file))
  // A symlink to the repository dependency tree crosses Next.js' tracing root
  // and can make the standalone writer escape its temporary output directory.
  // Clone files where the filesystem supports copy-on-write, with Node's
  // documented copy fallback elsewhere, so this remains a real build context.
  cpSync(join(ROOT, 'node_modules'), join(appRoot, 'node_modules'), {
    recursive: true,
    mode: fsConstants.COPYFILE_FICLONE,
    verbatimSymlinks: true,
  })
}

function createPostgrest(containerName, serviceName, port, uri, role, createdContainers) {
  try {
    docker([
      'compose',
      'run',
      '--detach',
      '--no-deps',
      '--name',
      containerName,
      '--publish',
      `127.0.0.1:${port}:3000`,
      '--env',
      `PGRST_DB_URI=${uri}`,
      '--env',
      `PGRST_DB_ANON_ROLE=${role}`,
      '--env',
      'PGRST_DB_SCHEMAS=public',
      serviceName,
    ])
    createdContainers.push(containerName)
  } catch (error) {
    const exists = spawnSync('docker', ['container', 'inspect', containerName], {
      cwd: ROOT,
      stdio: 'ignore',
    }).status === 0
    if (exists) createdContainers.push(containerName)
    throw error
  }
}

async function cleanupContainer(containerName) {
  const result = spawnSync('docker', ['rm', '--force', containerName], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0 && !result.stderr.includes('No such container')) {
    throw commandFailure(`remove ${containerName}`, result)
  }
}

async function main() {
  const services = []
  const createdContainers = []
  const cleanupErrors = []
  let databaseCreated = false
  let primaryError = null

  try {
    const usedPorts = new Set()
    const [publicPort, adminPort, issuerPort, appPort] = await Promise.all([
      freePort(usedPorts),
      freePort(usedPorts),
      freePort(usedPorts),
      freePort(usedPorts),
    ])
    const publicUrl = `http://127.0.0.1:${publicPort}`
    const adminUrl = `http://127.0.0.1:${adminPort}`
    const issuer = `http://127.0.0.1:${issuerPort}`
    const appUrl = `http://127.0.0.1:${appPort}`

    const dbContainerId = docker(['compose', 'ps', '--quiet', 'db'], { print: false })
    if (!dbContainerId) {
      throw new Error('The main Compose PostgreSQL service is not running; start db first')
    }
    const dbRunning = docker(
      ['inspect', '--format', '{{.State.Running}}', dbContainerId],
      { print: false },
    )
    if (dbRunning !== 'true') throw new Error('The main Compose PostgreSQL service is not running')

    const sharedRolesReady = docker(
      [
        'compose',
        'exec',
        '-T',
        'db',
        'psql',
        '-X',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-Atqc',
        `select count(*) = 5
         from pg_catalog.pg_roles
         where rolname in (
           'anon',
           'authenticated',
           'club_admin',
           'anon_authenticator',
           'admin_authenticator'
         );`,
      ],
      { print: false },
    )
    if (sharedRolesReady !== 't') {
      throw new Error('Local project roles are not configured; run npm run stack:up first')
    }

    psql('postgres', `create database ${database};`)
    databaseCreated = true
    console.log(`created isolated database ${database}`)

    runSync('expand migrations', process.execPath, ['scripts/migrate.mjs'], {
      env: childEnvironment({ MIGRATION_DB_NAME: database }),
    })
    runSync('contract migrations', process.execPath, ['scripts/migrate.mjs', '--phase', 'contract'], {
      env: childEnvironment({ MIGRATION_DB_NAME: database }),
    })
    runSync('database seed', process.execPath, ['scripts/seed.mjs'], {
      env: childEnvironment({ SEED_DB_NAME: database }),
    })

    psql(
      database,
      `insert into public.admin_user (user_id, note)
       values (${sqlString(adminSubject)}, 'isolated admin E2E harness')
       on conflict (user_id) do update set note = excluded.note;

       insert into public.photo (
         tournament_id,
         storage_key,
         width,
         height,
         caption,
         sort_order
       )
       select
         id,
         ${sqlString(legacyPublicPhotoKey)},
         1,
         1,
         'isolated media authorization probe',
         0
       from public.tournament
       where slug = '2025-nlc';`,
    )

    createPostgrest(
      publicContainer,
      'rest',
      publicPort,
      `postgres://anon_authenticator:local-anon-only@db:5432/${database}`,
      'anon',
      createdContainers,
    )
    createPostgrest(
      adminContainer,
      'rest-admin',
      adminPort,
      `postgres://admin_authenticator:local-admin-only@db:5432/${database}`,
      'club_admin',
      createdContainers,
    )
    await Promise.all([
      waitForHttp(publicUrl, 'public PostgREST', null, 30_000),
      waitForHttp(adminUrl, 'admin PostgREST', null, 30_000),
    ])
    const futurePostResponse = await fetch(
      `${adminUrl}/post?select=slug&slug=eq.recruit-2026`,
      { signal: AbortSignal.timeout(5_000) },
    )
    const futurePosts = await futurePostResponse.json()
    if (
      !futurePostResponse.ok ||
      !Array.isArray(futurePosts) ||
      !futurePosts.some(post => post.slug === 'recruit-2026')
    ) {
      throw new Error('Temporary admin PostgREST cannot read future posts')
    }

    const oidcService = await startProcess('oidc', process.execPath, ['scripts/dev-session.mjs'], {
      cwd: ROOT,
      env: childEnvironment({
        DEV_ISSUER: issuer,
        DEV_HOST: '127.0.0.1',
        DEV_AUD: audience,
        DEV_SUB: adminSubject,
        DEV_NON_ADMIN_SUB: nonAdminSubject,
        DEV_TOKEN_FILE: tokenFile,
        DEV_NON_ADMIN_TOKEN_FILE: nonAdminTokenFile,
      }),
    })
    services.push(oidcService)
    await Promise.all([
      waitForHttp(`${issuer}/.well-known/openid-configuration`, 'OIDC issuer', oidcService),
      waitForFiles([tokenFile, nonAdminTokenFile], oidcService),
    ])

    copyApplication()
    mkdirSync(photoRoot, { recursive: true })
    const mediaProbe = Buffer.from('isolated media authorization probe')
    const privateMediaTarget = join(photoRoot, legacyPublicPhotoKey)
    mkdirSync(dirname(privateMediaTarget), { recursive: true })
    writeFileSync(privateMediaTarget, mediaProbe)
    const registrationSecret = randomBytes(32).toString('base64url')
    const nextEnvironment = childEnvironment({
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      TZ: 'Asia/Shanghai',
      CLOUDBASE_ENV_ID: audience,
      CLOUDBASE_ISSUER: issuer,
      CLOUDBASE_REGION: 'ap-shanghai',
      RDB_BASE_URL: publicUrl,
      RDB_ADMIN_BASE_URL: adminUrl,
      NEXT_PUBLIC_SITE_URL: appUrl,
      PHOTO_UPLOAD_DRIVER: 'local',
      PHOTO_LOCAL_ROOT: photoRoot,
      PHOTO_BUCKET: 'cs2cup-e2e-photos',
      REGISTRATION_FINGERPRINT_SECRET: registrationSecret,
      REGISTRATION_CLIENT_IP_SOURCE: 'x-real-ip',
    })
    const nextBinary = join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
    runSync('isolated production build', process.execPath, [nextBinary, 'build'], {
      cwd: appRoot,
      env: nextEnvironment,
    })
    const standaloneRoot = join(appRoot, '.next', 'standalone')
    await packStandalone(appRoot)
    if (existsSync(join(standaloneRoot, 'public', 'photos'))) {
      throw new Error('Isolated production bundle unexpectedly contains public/photos')
    }
    if (!existsSync(join(standaloneRoot, 'THIRD_PARTY_NOTICES.md'))) {
      throw new Error('Isolated production bundle omitted third-party notices')
    }
    const nextService = await startProcess(
      'next',
      process.execPath,
      ['server.js'],
      {
        cwd: standaloneRoot,
        env: childEnvironment({
          ...nextEnvironment,
          HOSTNAME: '127.0.0.1',
          PORT: String(appPort),
        }),
      },
    )
    services.push(nextService)
    await waitForHttp(`${appUrl}/`, 'Next application', nextService)

    await runProcess('admin-e2e', process.execPath, ['scripts/admin-e2e.mjs'], {
      cwd: ROOT,
      env: childEnvironment({
        TZ: 'Asia/Shanghai',
        E2E_DB_NAME: database,
        E2E_DB_OWNED: '1',
        E2E_BASE_URL: appUrl,
        DEV_TOKEN_FILE: tokenFile,
        DEV_NON_ADMIN_TOKEN_FILE: nonAdminTokenFile,
        E2E_LEGACY_PUBLIC_PHOTO_KEY: legacyPublicPhotoKey,
        E2E_PHOTO_LOCAL_ROOT: photoRoot,
      }),
    })

    console.log(`admin E2E harness completed for ${database}`)
  } catch (error) {
    primaryError = error
  } finally {
    for (const service of services.reverse()) {
      try {
        await stopProcess(service)
      } catch (error) {
        cleanupErrors.push(new Error(`Failed to stop ${service.label}: ${error.message}`))
      }
    }

    for (const containerName of createdContainers.reverse()) {
      try {
        await cleanupContainer(containerName)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    if (databaseCreated) {
      try {
        psql('postgres', `drop database ${database} with (force);`, { ignoreAbort: true })
        console.log(`dropped isolated database ${database}`)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch (error) {
      cleanupErrors.push(new Error(`Failed to remove ${tempRoot}: ${error.message}`))
    }
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'Admin E2E and cleanup failed')
  }
  if (primaryError) throw primaryError
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Admin E2E cleanup failed')
}

try {
  await main()
} finally {
  for (const [signalName, handler] of signalHandlers) process.removeListener(signalName, handler)
}
