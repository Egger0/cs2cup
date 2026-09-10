import assert from 'node:assert/strict'

const { qqGroupContact } = await import('../lib/qq-group.ts')

assert.equal(qqGroupContact(null), null)
assert.equal(qqGroupContact('  '), null)
assert.deepEqual(qqGroupContact('661543515'), { kind: 'number', number: '661543515' })
assert.deepEqual(qqGroupContact(' 661 543 515 '), { kind: 'number', number: '661543515' })

const invite = qqGroupContact('https://qm.qq.com/q/AbCdEf123')
assert.equal(invite?.kind, 'invite')
assert.equal(invite?.href, 'https://qm.qq.com/q/AbCdEf123')
assert.equal(invite?.number, null)

const withCode = qqGroupContact('https://qm.qq.com/cgi-bin/qm/qr?k=Key_1&group_code=661543515')
assert.equal(withCode?.kind, 'invite')
assert.equal(withCode?.number, '661543515')

assert.equal(qqGroupContact('http://qm.qq.com/q/AbCdEf123'), null, 'plain http is rejected')
assert.equal(qqGroupContact('https://evil.example/q/x'), null, 'foreign hosts are rejected')
assert.equal(
  qqGroupContact('https://qm.qq.com.evil.example/q/x'),
  null,
  'lookalike hosts are rejected',
)
assert.equal(
  qqGroupContact('mqqapi://card/show_pslcard?uin=661543515&card_type=group'),
  null,
  'app-only schemes never reach the page',
)
assert.equal(qqGroupContact('javascript:alert(1)'), null)

const both = qqGroupContact('661543515 https://qm.qq.com/q/hSolmJ1LXi')
assert.equal(both?.kind, 'invite')
assert.equal(both?.href, 'https://qm.qq.com/q/hSolmJ1LXi')
assert.equal(both?.number, '661543515', 'a number beside the link is kept for display')

const reversed = qqGroupContact('https://qm.qq.com/q/hSolmJ1LXi\n661543515')
assert.equal(reversed?.kind, 'invite')
assert.equal(reversed?.number, '661543515')

assert.equal(
  qqGroupContact('661543515 https://evil.example/q/x')?.kind,
  'number',
  'a rejected link falls back to the number',
)

console.log('QQ group contact tests passed')
