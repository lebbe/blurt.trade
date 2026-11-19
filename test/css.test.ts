import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { minifyCss } from '../src/css.ts'
import { stylesheetUrl } from '../src/pages/shared/layout.ts'
import { request } from './helpers.ts'

test('minifyCss drops comments and spaces the grammar does not need', () => {
  assert.equal(
    minifyCss('/* c */\na  >  b,\nc {\n  margin: 0 auto;\n  color: red;\n}\n'),
    'a>b,c{margin:0 auto;color:red}',
  )
})

test('minifyCss keeps the spaces that mean something', () => {
  // Descendant selector, not a pseudo-class on `a`.
  assert.equal(minifyCss('a :hover { x: y }'), 'a :hover{x:y}')
  // calc() needs the spaces around + and -.
  assert.equal(
    minifyCss('.x { width: calc(100% + 32px - 2px); }'),
    '.x{width:calc(100% + 32px - 2px)}',
  )
  // Strings are copied as they are, braces and comment markers included.
  assert.equal(minifyCss('a::after { content: " {  /* } "; }'), 'a::after{content:" {  /* } "}')
  assert.equal(minifyCss(".x { font-family: 'A  B', serif; }"), ".x{font-family:'A  B',serif}")
  // A comment between two words is a space, not nothing.
  assert.equal(minifyCss('.x { margin: 1px/**/2px; }'), '.x{margin:1px 2px}')
  assert.equal(
    minifyCss('@media (min-width: 600px) and (max-width: 900px) { a { b: c } }'),
    '@media (min-width:600px) and (max-width:900px){a{b:c}}',
  )
})

test('serves the stylesheet minified, with an ETag that answers 304', async () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'public', 'style.css'), 'utf8')
  const response = await request('GET', stylesheetUrl)
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'] as string, /^text\/css/)
  assert.equal(response.body, minifyCss(source))
  assert.ok(response.body.length < source.length * 0.8)
  assert.doesNotMatch(response.body, /\/\*/)
  const etag = response.headers.etag as string
  const again = await request('GET', stylesheetUrl, '', { 'if-none-match': etag })
  assert.equal(again.statusCode, 304)
})
