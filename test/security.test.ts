import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { db } from '../src/db.ts'
import { mapUrl } from '../src/geo.ts'
import {
  contentSecurityPolicy,
  permissionsPolicy,
  strictTransportSecurity,
} from '../src/middleware/security-headers.ts'
import { stylesheetUrl } from '../src/templates/layout.ts'
import { criticalCss, criticalCssMaxLines, defaultTheme, themes } from '../src/themes.ts'
import { createSession, request, stylesheet } from './helpers.ts'

test('refuses to start in production without a strong JWT_SECRET', () => {
  const authModule = pathToFileURL(
    join(import.meta.dirname, '..', 'src', 'middleware', 'auth.ts'),
  ).href
  // One process: each takes seconds. The production test below starts with a good secret.
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import('${authModule}')`],
    { env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'too-short' }, encoding: 'utf8' },
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /JWT_SECRET/)
})

function assertSecurityHeaders(headers: http.IncomingHttpHeaders, what: string): void {
  assert.equal(headers['content-security-policy'], contentSecurityPolicy, what)
  assert.equal(headers['x-content-type-options'], 'nosniff', what)
  assert.equal(headers['referrer-policy'], 'same-origin', what)
  assert.equal(headers['permissions-policy'], permissionsPolicy, what)
  assert.equal(headers['x-frame-options'], 'DENY', what)
  assert.equal(headers['x-powered-by'], undefined, what)
  // Production only, and the tests don't run in production.
  assert.equal(headers['strict-transport-security'], undefined, what)
}

test('sends the security headers on pages, errors and static files', async () => {
  assert.match(contentSecurityPolicy, /default-src 'none'/)
  assert.doesNotMatch(contentSecurityPolicy, /script-src|unsafe-inline|unsafe-eval/)

  const cookie = await createSession('Lars')
  const responses = {
    page: await request('GET', '/'),
    'logged-in page': await request('GET', '/Lars/edit', '', { cookie }),
    json: await request('GET', '/', '', { accept: 'application/json' }),
    markdown: await request('GET', '/', '', { accept: 'text/markdown' }),
    404: await request('GET', '/no/such/page/here'),
    406: await request('GET', '/', '', { accept: 'application/xml' }),
    'failed form': await request('POST', '/api/blurts', 'text=', { cookie }),
    'malformed JSON': await request('POST', '/api/blurts', '{', {
      'content-type': 'application/json',
      cookie,
    }),
    map: await request('GET', mapUrl),
    stylesheet: await request('GET', stylesheetUrl),
  }
  assert.equal(responses[404].statusCode, 404)
  assert.equal(responses['malformed JSON'].statusCode, 400)
  for (const [what, response] of Object.entries(responses)) {
    assertSecurityHeaders(response.headers, what)
  }
})

test('pages use no inline styles or scripts, so the CSP needs no unsafe-inline', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=hello', { cookie })
  await request('POST', '/api/location', 'location.x=381&location.y=60', { cookie })
  const id = (await db().query('SELECT id FROM blurts')).rows[0].id

  for (const path of ['/', '/login', '/createUser', '/Lars/', `/Lars/${id}`, '/Lars/edit']) {
    const page = await request('GET', path, '', { cookie })
    assert.equal(page.statusCode, 200, path)
    // The one inline <style> is the theme's above-the-fold CSS, allowed by its hash.
    const critical = `<style>${criticalCss(defaultTheme)}</style>`
    assert.ok(page.body.includes(critical), path)
    const rest = page.body.replace(critical, '')
    assert.doesNotMatch(rest, /<style|\sstyle=|<script|\son\w+=|javascript:/i, path)
    assert.ok(page.body.includes(`<link rel="stylesheet" href="${stylesheetUrl}"/>`), path)
  }

  // Each theme's above-the-fold CSS is short, and the CSP allows exactly it by hash.
  for (const { id } of themes) {
    const css = criticalCss(id)
    assert.ok(css.split('\n').length <= criticalCssMaxLines, id)
    const hash = createHash('sha256').update(css, 'utf8').digest('base64')
    assert.ok(contentSecurityPolicy.includes(`'sha256-${hash}'`), id)
    const picked = await request('POST', '/api/theme', `theme=${id}`, { cookie })
    const access = picked.setCookie?.[0]?.split(';', 1)[0] ?? ''
    const themed = await request('GET', '/about', '', { cookie: access })
    assert.ok(themed.body.includes(`<style>${css}</style>`), id)
  }
  assert.doesNotMatch(contentSecurityPolicy, /unsafe-inline/)

  // The linked stylesheet is ours (style-src 'self') and holds the avatar animation.
  const css = await request('GET', stylesheetUrl)
  assert.equal(css.statusCode, 200)
  assert.match(css.contentType ?? '', /^text\/css/)
  assert.equal(css.body, stylesheet)
  assert.match(css.body, /@keyframes avatar-talk/)
  assert.match(css.headers['cache-control'] ?? '', /max-age=0/)
  assert.equal(typeof css.headers.etag, 'string')
  const notModified = await request('GET', stylesheetUrl, '', {
    'if-none-match': String(css.headers.etag),
  })
  assert.equal(notModified.statusCode, 304)
  assert.equal(notModified.body, '')
})

test('user text cannot break out of the HTML or the Markdown', async () => {
  const cookie = await createSession('Lars')
  const attack =
    '</p><script>alert(1)</script><img src=x onerror=alert(1)> [x](javascript:alert(1))'
  await request('POST', '/api/blurts', `text=${encodeURIComponent(attack)}`, { cookie })
  await request('POST', '/Lars/edit', `bio=${encodeURIComponent(attack)}`, { cookie })

  for (const path of ['/', '/Lars/']) {
    const page = await request('GET', path, '', { cookie })
    assert.doesNotMatch(page.body, /<script|<img|href="javascript/i, path)
    assert.ok(page.body.includes('&lt;/p>&lt;script>alert(1)&lt;/script>'), path)

    const markdown = await request('GET', path, '', { accept: 'text/markdown', cookie })
    assert.match(markdown.contentType ?? '', /^text\/markdown/)
    assert.ok(markdown.body.includes(String.raw`\<script\>alert(1)\</script\>`), path)
    assert.ok(markdown.body.includes(String.raw`\[x\](javascript:alert(1))`), path)
    // Never sniffed as HTML.
    assert.equal(markdown.headers['x-content-type-options'], 'nosniff')
  }
})

test('in production: HSTS, and session cookies are __Host-, Secure, HttpOnly, SameSite=Lax', () => {
  const serverModule = pathToFileURL(join(import.meta.dirname, '..', 'src', 'server.ts')).href
  const script = `
    const { app } = await import('${serverModule}')
    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const base = 'http://localhost:' + server.address().port
    const response = await fetch(base + '/createUser', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=Prod&password=correct-horse',
      redirect: 'manual',
    })
    console.log(JSON.stringify({
      status: response.status,
      hsts: response.headers.get('strict-transport-security'),
      cookies: response.headers.getSetCookie(),
    }))
    process.exit(0)
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  // The last line; the ones before it are the server's request logs.
  const { status, hsts, cookies } = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '')
  assert.equal(status, 303)
  assert.equal(hsts, strictTransportSecurity)
  for (const name of ['__Host-access_token', '__Host-refresh_token', 'recent_write']) {
    const cookie = (cookies as string[]).find((value) => value.startsWith(`${name}=`))
    assert.ok(cookie, name)
    assert.match(cookie, /; Path=\/(;|$)/, name)
    assert.match(cookie, /; HttpOnly(;|$)/, name)
    assert.match(cookie, /; Secure(;|$)/, name)
    assert.match(cookie, /; SameSite=Lax(;|$)/, name)
    assert.doesNotMatch(cookie, /; Domain=/i, name)
  }
})
