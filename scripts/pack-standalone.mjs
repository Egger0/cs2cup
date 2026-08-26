import { cp, access } from 'node:fs/promises'
import { constants } from 'node:fs'

const copies = [
  ['public', '.next/standalone/public'],
  ['.next/static', '.next/standalone/.next/static'],
  ['.env.local', '.next/standalone/.env.local'],
]

for (const [from, to] of copies) {
  try {
    await access(from, constants.R_OK)
  } catch {
    continue
  }
  await cp(from, to, { recursive: true, force: true })
  console.log('copied', from)
}
