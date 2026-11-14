import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../src/db.ts'
import { contentSecurityPolicy } from '../src/middleware/security-headers.ts'
import { speculationRulesPath, speculationRulesType } from '../src/speculation.ts'
import {
  blurtIdByText,
  collectLogs,
  cookiesSet,
  createSession,
  json,
  request,
  signUp,
  stylesheet,
} from './helpers.ts'

const prefetch = { 'sec-purpose': 'prefetch' }
const rulesHeader = `"${speculationRulesPath}"`

test('HTML pages name the speculation rules, served with their own type and under the CSP', async () => {
  const cookie = await createSession('Lars')
  for (const path of ['/', '/about', '/Lars/', '/no/such/page']) {
    const page = await request('GET', path, '', { cookie })
    assert.equal(page.headers['speculation-rules'], rulesHeader, path)
    // bfcache: pages are not no-store, logged in or not.
    assert.equal(page.headers['cache-control'], undefined, path)
  }
  // Only pages: other representations have no links to prefetch.
  assert.equal((await request('GET', '/', '', json)).headers['speculation-rules'], undefined)
  const markdown = await request('GET', '/', '', { accept: 'text/markdown' })
  assert.equal(markdown.headers['speculation-rules'], undefined)

  const rules = await request('GET', speculationRulesPath)
  assert.equal(rules.statusCode, 200)
  assert.equal(rules.contentType?.split(';', 1)[0], speculationRulesType)
  assert.equal(rules.headers['content-security-policy'], contentSecurityPolicy)
  // Fetched from the header, so the CSP needs no script-src and stays script-free.
  assert.doesNotMatch(contentSecurityPolicy, /script-src|inline-speculation-rules/)
  assert.deepEqual(
    JSON.parse(rules.body),
    JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'public', 'speculation-rules.json'), 'utf8'),
    ),
  )
})

test('the rules prefetch ordinary pages on hover and leave out actions and heavy pages', async () => {
  const rules = JSON.parse((await request('GET', speculationRulesPath)).body)
  assert.deepEqual(Object.keys(rules), ['prefetch']) // no prerender
  const [rule] = rules.prefetch
  assert.equal(rule.eagerness, 'moderate')
  const [{ href_matches: include }, { not: exclude }] = rule.where.and
  const base = 'https://blurt.test/'
  const matches = (patterns: string | string[], path: string) =>
    [patterns].flat().some((pattern) => new URLPattern(pattern, base).test(path, base))
  const prefetched = (path: string) =>
    matches(include, path) && !matches(exclude.href_matches, path)

  for (const path of ['/', '/everyone', '/about', '/Lars/', '/Lars/12', '/Lars/?before=5']) {
    assert.ok(prefetched(path), path)
  }
  for (const path of [
    '/api/logout',
    '/api/blurts',
    '/logout',
    '/search?q=hello',
    '/near',
    '/admin',
    '/admin/reports',
    '/static/style.css',
  ]) {
    assert.ok(!prefetched(path), path)
  }
  // Usernames that only start like an excluded path are still pages.
  assert.ok(prefetched('/searchlight/'))
  assert.ok(!prefetched('https://elsewhere.test/'))
})

test('pages cross-fade on navigation, unless reduced motion is asked for', () => {
  assert.match(
    stylesheet,
    /@media \(prefers-reduced-motion: no-preference\) \{\s*@view-transition \{\s*navigation: auto;\s*\}\s*\}/,
  )
  assert.equal(stylesheet.match(/@view-transition/g)?.length, 1)
})

test('a prefetch never reads notifications: the blurt page refuses it, the click reads them', async (t) => {
  const logs = collectLogs(t)
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=mine', { cookie: lars })
  const mine = await blurtIdByText('mine')
  await request('POST', '/api/blurts', `text=a+reply&parentId=${mine}`, { cookie: ada })
  const unread = async () =>
    (await db().query('SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL')).rows[0]
      .n
  assert.equal(await unread(), 1)

  for (const purpose of ['prefetch', 'prefetch;prerender']) {
    const refused = await request('GET', `/Lars/${mine}`, '', {
      cookie: lars,
      'sec-purpose': purpose,
    })
    assert.equal(refused.statusCode, 503, purpose)
    assert.equal(refused.headers['cache-control'], 'no-store')
    assert.equal(refused.setCookie, undefined)
    assert.equal(await unread(), 1, purpose)
  }
  // Not a server fault: logged as info and not counted towards alerts.
  const lines = logs.filter((line) => line.status === 503)
  assert.equal(lines.length, 2)
  assert.ok(lines.every((line) => line.level === 'info'))

  // Nothing to read, anonymous, or someone else's blurt: prefetched as usual.
  const other = await request('GET', `/Ada/${await blurtIdByText('a reply')}`, '', prefetch)
  assert.equal(other.statusCode, 200)

  const visit = await request('GET', `/Lars/${mine}`, '', { cookie: lars })
  assert.equal(visit.statusCode, 200)
  assert.equal(await unread(), 0)
  const again = await request('GET', `/Lars/${mine}`, '', { cookie: lars, ...prefetch })
  assert.equal(again.statusCode, 200)
})

test('a prefetch never rotates the refresh token: it is refused until the real navigation', async () => {
  const { refresh_token: refresh, access_token: access } = await signUp()
  const generation = async () =>
    (await db().query('SELECT current_generation AS g FROM sessions')).rows[0].g
  const before = await generation()

  const refused = await request('GET', '/about', '', {
    cookie: `refresh_token=${refresh}`,
    ...prefetch,
  })
  assert.equal(refused.statusCode, 503)
  assert.equal(refused.setCookie, undefined)
  assert.equal(await generation(), before)

  // With a live access token there is nothing to rotate, so the prefetch is served.
  const served = await request('GET', '/about', '', {
    cookie: `access_token=${access}; refresh_token=${refresh}`,
    ...prefetch,
  })
  assert.equal(served.statusCode, 200)
  assert.equal(served.setCookie, undefined)

  const real = await request('GET', '/about', '', { cookie: `refresh_token=${refresh}` })
  assert.equal(real.statusCode, 200)
  assert.ok(cookiesSet(real).refresh_token)
  assert.equal(await generation(), before + 1)
})

test('every write sent with fetch() tells the browser to drop its prefetched pages, and only those', async () => {
  const lars = await createSession('Lars')
  const clear = '"prefetchCache", "prerenderCache"'
  const posted = await request('POST', '/api/blurts', 'text=hello', { cookie: lars, ...json })
  assert.equal(posted.statusCode, 201)
  assert.equal(posted.headers['clear-site-data'], clear)
  const form = await request('POST', '/api/blurts', 'text=again', { cookie: lars })
  assert.equal(form.statusCode, 303)
  // A form POST replaces the page, and its prefetches with it.
  assert.equal(form.headers['clear-site-data'], undefined)
  const page = await request('GET', '/', '', { cookie: lars })
  assert.equal(page.headers['clear-site-data'], undefined)
})
