import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Wrangler exited with ${code}`)))
  })
}

async function main() {
  const source = resolve(process.argv[2] || 'migration-output/cloudbase-export')
  const bucket = process.argv[3] || 'cs2cup-preview-media'
  const manifest = JSON.parse(await readFile(join(source, 'media-manifest.json'), 'utf8'))
  if (!Array.isArray(manifest?.objects)) throw new Error('media-manifest.json is invalid')
  for (const object of manifest.objects) {
    if (typeof object?.key !== 'string' || !object.key) throw new Error('media manifest has an invalid key')
    await run('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${object.key}`, '--file', join(source, 'media', ...object.key.split('/')), '--remote'])
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'R2 upload failed'); process.exit(1) })
