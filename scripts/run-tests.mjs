import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'

const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const commands = Object.entries(scripts)
  .filter(([name]) => name !== 'test')
  .map(([, command]) => command)
const tests = Object.keys(scripts).filter(
  name =>
    name.startsWith('test:') &&
    !commands.some(command => new RegExp(`npm run ${name}(?:\\s|$)`).test(command)),
)

const started = performance.now()
const failures = []
let next = 0

function run(name) {
  return new Promise(resolve => {
    const begin = performance.now()
    const child = spawn('sh', ['-c', scripts[name]], {
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => (output += chunk))
    child.stderr.on('data', chunk => (output += chunk))
    child.on('close', code => {
      const seconds = ((performance.now() - begin) / 1000).toFixed(1)
      if (code === 0) console.log(`ok    ${name} (${seconds}s)`)
      else {
        console.log(`FAIL  ${name} (${seconds}s)`)
        failures.push({ name, output })
      }
      resolve()
    })
  })
}

async function worker() {
  while (next < tests.length) await run(tests[next++])
}

await Promise.all(Array.from({ length: Math.min(availableParallelism(), tests.length) }, worker))

for (const { name, output } of failures) console.log(`\n--- ${name} ---\n${output.trim()}`)
const total = ((performance.now() - started) / 1000).toFixed(1)
console.log(`\n${tests.length - failures.length}/${tests.length} test suites passed in ${total}s`)
if (failures.length) process.exitCode = 1
