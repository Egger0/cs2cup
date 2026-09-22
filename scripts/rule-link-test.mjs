import assert from 'node:assert/strict'

import { ruleBodySegments } from '../lib/rule-links.ts'

assert.deepEqual(ruleBodySegments('查看 https://docs.qq.com/doc/DWWZWeFVnY1h6S3FN 获取细则'), [
  { kind: 'text', value: '查看 ' },
  {
    kind: 'link',
    value: 'https://docs.qq.com/doc/DWWZWeFVnY1h6S3FN',
    href: 'https://docs.qq.com/doc/DWWZWeFVnY1h6S3FN',
  },
  { kind: 'text', value: ' 获取细则' },
])
assert.deepEqual(ruleBodySegments('没有链接'), [{ kind: 'text', value: '没有链接' }])

console.log('rule link tests passed')
