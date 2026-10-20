import test from 'node:test'
import assert from 'node:assert/strict'
import { h } from 'preact'
import renderToString from 'preact-render-to-string'
import { code, escape, join, link, md, raw } from '../src/templates/markdown.ts'
import { renderBlurtText, sanitizeBlurtLinks } from '../src/templates/blurt-text.ts'

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

test('renders bare URLs and Markdown links in one safe pass', () => {
  const rendered = renderToString(
    h(
      'p',
      null,
      renderBlurtText(
        'Visit https://example.com/?utm_medium=post&keep=1. [Listen](https://open.spotify.com/artist/123)',
      ),
    ),
  )
  assert.equal(
    rendered,
    '<p>Visit <a href="https://example.com/?keep=1" rel="noreferrer noopener nofollow ugc" referrerpolicy="no-referrer">https://example.com/?keep=1</a>. <a href="https://open.spotify.com/artist/123" rel="noreferrer noopener nofollow ugc" referrerpolicy="no-referrer">Listen</a> (open.spotify.com)</p>',
  )
})

test('does not link unsafe protocols and escapes user text', () => {
  const rendered = renderToString(
    h('p', null, renderBlurtText('[<img>](javascript:alert(1)) <img src=x onerror=alert(1)>')),
  )
  assert.equal(rendered, '<p>[&lt;img>](javascript:alert(1)) &lt;img src=x onerror=alert(1)></p>')
  assert.doesNotMatch(rendered, /<a|<img/)
})

test('strips tracking parameters from both URL syntaxes', () => {
  assert.equal(
    sanitizeBlurtLinks(
      'https://example.com/?UTM_source=feed&fbclid=click&keep=1 [text](https://example.com/?gclid=click&mc_eid=email&igshid=share)',
    ),
    'https://example.com/?keep=1 [text](https://example.com/)',
  )
})

test('strips click ids, campaign ids and gad_* parameters', () => {
  const params = [
    'gad_source=1',
    'gad_campaignid=2',
    'gbraid=a',
    'wbraid=b',
    'dclid=c',
    '_gl=d',
    'msclkid=e',
    'ttclid=f',
    'twclid=g',
    'li_fat_id=h',
    'yclid=i',
    'mc_cid=j',
    '_hsenc=k',
    '_hsmi=l',
    'mkt_tok=m',
    'igsh=n',
  ]
  assert.equal(
    sanitizeBlurtLinks(`https://example.com/?${params.join('&')}&keep=1`),
    'https://example.com/?keep=1',
  )
})

test('strips si only on Spotify and YouTube hosts', () => {
  assert.equal(
    sanitizeBlurtLinks(
      'https://open.spotify.com/track/1?si=x&keep=1 https://www.youtube.com/watch?v=abc&si=x https://youtu.be/abc?si=x https://music.youtube.com/watch?v=abc&si=x',
    ),
    'https://open.spotify.com/track/1?keep=1 https://www.youtube.com/watch?v=abc https://youtu.be/abc https://music.youtube.com/watch?v=abc',
  )
  assert.equal(
    sanitizeBlurtLinks('https://example.com/?si=x https://notyoutube.com/?si=x'),
    'https://example.com/?si=x https://notyoutube.com/?si=x',
  )
})
