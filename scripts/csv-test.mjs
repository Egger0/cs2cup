import assert from 'node:assert/strict'

import { encodeCsv } from '../lib/csv.ts'

const csv = encodeCsv([
  ['plain', 'comma,value', 'quote"value', null],
  ['=SUM(A1:A2)', ' \t+command', '-1+2', '@name'],
  ['\n=command', '\u00a0@name', 'line\r\nbreak', 'safe'],
])

assert.equal(
  csv,
  [
    'plain,"comma,value","quote""value",',
    "'=SUM(A1:A2),' \t+command,'-1+2,'@name",
    '"\'\n=command",\'\u00a0@name,"line\r\nbreak",safe',
    '',
  ].join('\r\n'),
)

console.log('CSV tests passed')
