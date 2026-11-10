import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(
  new URL('../.github/workflows/quality.yml', import.meta.url),
  'utf8',
)
const installed = JSON.parse(
  await readFile(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8'),
).version
const image = /mcr\.microsoft\.com\/playwright:v([\d.]+)-/.exec(workflow)?.[1]

assert.equal(
  image,
  installed,
  `The CI browser image must match playwright ${installed}, or its browsers will not launch`,
)
console.log(`CI browser image matches playwright ${installed}`)
