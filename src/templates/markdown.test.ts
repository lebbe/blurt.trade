import test from 'node:test'
import assert from 'node:assert/strict'
import { code, escape, join, link, md, raw } from './markdown.ts'

test('escapes interpolated text but not Markdown values', () => {
  const name = '*bold* [x](javascript:alert(1)) <b>'
  assert.equal(
    md`**${name}** ${md`_${'a_b'}_`}`.text,
    '**\\*bold\\* \\[x\\](javascript:alert(1)) \\<b\\>** _a\\_b_',
  )
})

test('escapes block syntax only at the start of a line', () => {
  assert.equal(
    escape('# no\n- no\n1. no\n    code? no\na-b 1.5 c#'),
    '\\# no\n\\- no\n1\\. no\ncode? no\na-b 1.5 c#',
  )
})

test('dedents the template and drops the surrounding blank lines', () => {
  const text = md`
    # ${'Title'}

      indented
  `
  assert.equal(text.text, '# Title\n\n  indented')
})

test('drops lines that only held empty values and collapses blank lines', () => {
  const text = md`
    a

    ${false}

    ${null} ${undefined}

    b ${false}
  `
  assert.equal(text.text, 'a\n\nb')
})

test('renders arrays as blocks, and join() with any separator', () => {
  assert.equal(md`${['a', raw('*b*'), null]}`.text, 'a\n\n*b*')
  assert.equal(md`${join(['a', 'b'], ', ')}`.text, 'a, b')
})

test('continues blockquotes and list items over multi-line values', () => {
  const text = 'line one\n\nline two'
  assert.equal(md`> **x**: ${text}`.text, '> **x**: line one\n>\n> line two')
  assert.equal(md`- ${text}`.text, '- line one\n\n  line two')
  assert.equal(md`  1. ${text}`.text, '1. line one\n\n   line two')
})

test('builds links, code spans and dates safely', () => {
  assert.equal(link('a]b', '/x y').text, '[a\\]b](</x%20y>)')
  assert.equal(code('a`b').text, '``a`b``')
  assert.equal(code('`a').text, '`` `a ``')
  assert.equal(md`${new Date('2026-10-10T12:00:00.000Z')}`.text, '2026-10-10T12:00:00.000Z')
  assert.equal(md`${raw('*trusted*')}`.text, '*trusted*')
})
