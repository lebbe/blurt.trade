import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { db } from '../src/db.ts'
import {
  importMapHash,
  importMapJson,
  mainModulePreloads,
  mainModuleUrl,
} from '../src/client-modules.ts'
import {
  contentSecurityPolicy,
  scriptingContentSecurityPolicy,
} from '../src/middleware/security-headers.ts'
import { accessTokenCookie, refreshTokenCookie } from '../src/middleware/auth.ts'
import { preactBundleUrl } from '../src/vendor.ts'
import { cookiesSet, createSession, json, request, sendJson } from './helpers.ts'

// "Use JavaScript" (src/javascript.ts): on by default; off, the page has no script at all.

const pages = ['/', '/about', '/privacy', '/login', '/people', '/no/such/page']

function assertNoScripts(
  response: { body: string; headers: Record<string, unknown> },
  what: string,
) {
  assert.doesNotMatch(response.body, /<script|importmap|modulepreload|\/static\/js\//, what)
  assert.equal(response.headers['content-security-policy'], contentSecurityPolicy, what)
}

function assertScripts(response: { body: string; headers: Record<string, unknown> }, what: string) {
  const { body } = response
  assert.ok(body.includes(`<script type="importmap">${importMapJson}</script>`), what)
  assert.ok(body.includes(`<script type="module" src="${mainModuleUrl}"></script>`), what)
  for (const url of mainModulePreloads) {
    assert.ok(body.includes(`<link rel="modulepreload" href="${url}"/>`), `${what}: ${url}`)
  }
  assert.ok(body.includes(`<link rel="modulepreload" href="${preactBundleUrl}"/>`), what)
  assert.match(body, /<script type="application\/json" id="page-context">/, what)
  // The import map comes before any module, as browsers require.
  assert.ok(body.indexOf('importmap') < body.indexOf('modulepreload'), what)
  assert.equal(response.headers['content-security-policy'], scriptingContentSecurityPolicy, what)
}

function pageContextOf(body: string): Record<string, unknown> {
  const match = /<script type="application\/json" id="page-context">([^<]*)<\/script>/.exec(body)
  assert.ok(match, 'has the page context')
  return JSON.parse(match[1])
}

test('pages carry the import map, main.ts and the page context, allowed by the CSP', async () => {
  for (const path of pages) {
    assertScripts(await request('GET', path), path)
  }
  // The CSP allows exactly the import map that is on the page, by its hash.
  const page = await request('GET', '/')
  const inline = /<script type="importmap">([^<]*)<\/script>/.exec(page.body)?.[1] ?? ''
  const hash = createHash('sha256').update(inline, 'utf8').digest('base64')
  assert.equal(importMapHash, `'sha256-${hash}'`)
  assert.ok(String(page.headers['content-security-policy']).includes(`'sha256-${hash}'`))
  assert.deepEqual(JSON.parse(inline).imports.preact, preactBundleUrl)
  // Only the frame's pages: JSON, Markdown and static files have no scripts in them.
  assert.doesNotMatch((await request('GET', '/', '', json)).body, /importmap/)
  assert.doesNotMatch(
    (await request('GET', '/', '', { accept: 'text/markdown' })).body,
    /importmap/,
  )

  const cookie = await createSession('Lars')
  const context = pageContextOf((await request('GET', '/settings', '', { cookie })).body)
  assert.equal((context.viewer as { username: string }).username, 'Lars')
  assert.equal(context.path, '/settings')
  assert.equal(context.javascript, true)
  assert.equal(typeof context.timeZone, 'string')
})

test('the page context JSON cannot end its <script> element', async () => {
  const response = await request('GET', '/</script><script>alert(1)</script>')
  assert.equal(response.statusCode, 404)
  assert.ok(!response.body.includes('<script>alert(1)'))
  assert.ok(response.body.includes('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>'))
  assert.equal(pageContextOf(response.body).path, '/</script><script>alert(1)</script>')
})

test('anonymous visitors turn JavaScript off and on with a cookie, without JS', async () => {
  for (const path of pages) {
    assertNoScripts(await request('GET', path, '', { cookie: 'javascript=off' }), path)
  }
  // The footer link names the way back, and /about has the form.
  const offPage = await request('GET', '/about', '', { cookie: 'javascript=off' })
  assert.match(offPage.body, /<a href="\/about#javascript">Turn JavaScript on<\/a>/)
  assert.match(offPage.body, /<input type="hidden" name="javascript" value="on"\/>/)
  const onPage = await request('GET', '/about')
  assert.match(onPage.body, /<a href="\/about#javascript">Turn JavaScript off<\/a>/)
  assert.match(onPage.body, /<form method="post" action="\/api\/javascript"/)

  const off = await request('POST', '/api/javascript', 'javascript=off')
  assert.equal(off.statusCode, 303)
  assert.equal(off.location, '/about#javascript')
  const cookie = off.setCookie?.find((value) => value.startsWith('javascript=off'))
  assert.ok(cookie, 'sets the cookie')
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /Path=\//)
  assert.match(cookie, /Max-Age=34560000/)

  const on = await request('POST', '/api/javascript', 'javascript=on', {
    cookie: 'javascript=off',
  })
  assert.equal(on.statusCode, 303)
  assert.equal(cookiesSet(on).javascript, '')

  const asJson = await sendJson('/api/javascript', { javascript: false })
  assert.equal(asJson.statusCode, 200)
  assert.deepEqual(JSON.parse(asJson.body), { javascript: false })
  assert.equal(cookiesSet(asJson).javascript, 'off')

  for (const value of ['', 'maybe', '1', 'OFF']) {
    const bad = await request('POST', '/api/javascript', `javascript=${value}`, json)
    assert.equal(bad.statusCode, 400, value)
    assert.equal(JSON.parse(bad.body).field, 'javascript')
  }
})

test('logged in, the setting is saved on the account and carried in the access token', async () => {
  const session = await createSession('Lars')
  const settings = await request('GET', '/settings', '', { cookie: session })
  assertScripts(settings, '/settings')
  assert.match(settings.body, /id="javascript"/)
  assert.match(settings.body, /<a href="\/settings#javascript">Turn JavaScript off<\/a>/)

  const off = await request('POST', '/api/javascript', 'javascript=off', { cookie: session })
  assert.equal(off.statusCode, 303)
  assert.equal(off.location, '/settings#javascript')
  const { rows } = await db().query(
    "SELECT javascript FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE username = 'Lars'",
  )
  assert.equal(rows[0].javascript, false)
  // The new access token says so, so this browser's next page has no scripts.
  const access = cookiesSet(off)[accessTokenCookie]
  assert.ok(access)
  const cookie = `${accessTokenCookie}=${access}`
  for (const path of ['/', '/settings', '/Lars/', '/Lars/edit', '/about']) {
    assertNoScripts(await request('GET', path, '', { cookie }), path)
  }
  // The account counts while logged in, whatever this browser's cookie says.
  assertNoScripts(await request('GET', '/', '', { cookie: `${cookie}; javascript=on` }), 'cookie')

  // Another browser reads it from the account when it logs in, and again when its access
  // token has run out and the refresh token renews it.
  const login = cookiesSet(await request('POST', '/login', 'username=Lars&password=correct-horse'))
  const loginAccess = `${accessTokenCookie}=${login[accessTokenCookie]}`
  assertNoScripts(await request('GET', '/', '', { cookie: loginAccess }), 'new login')
  const refreshOnly = `${refreshTokenCookie}=${login[refreshTokenCookie]}`
  const refreshed = await request('GET', '/', '', { cookie: refreshOnly })
  assert.ok(cookiesSet(refreshed)[accessTokenCookie], 'refreshed the tokens')
  assertNoScripts(refreshed, 'after a refresh')

  const on = await request('POST', '/api/javascript', 'javascript=on', { cookie })
  const onAccess = cookiesSet(on)[accessTokenCookie]
  assertScripts(
    await request('GET', '/', '', { cookie: `${accessTokenCookie}=${onAccess}; javascript=off` }),
    'back on',
  )
})
