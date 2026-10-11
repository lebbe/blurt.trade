import test from 'node:test'
import assert from 'node:assert/strict'
import { stylesheetUrl } from '../src/templates/layout.ts'
import { themes } from '../src/themes.ts'
import { createSession, json, request, sendJson } from './helpers.ts'

test('picks a colour theme on the edit page, kept in a cookie, without JS', async () => {
  const cookie = await createSession('Lars')

  // The default theme is style.css alone.
  const before = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(before.body, /<form method="post" action="\/api\/theme"/)
  assert.match(before.body, /<input type="radio" name="theme" value="midnight-clay" checked/)
  assert.doesNotMatch(before.body, /\/static\/themes\//)

  const picked = await request('POST', '/api/theme', 'theme=plum-steel', { cookie })
  assert.equal(picked.statusCode, 303)
  assert.equal(picked.location, '/Lars/edit#theme')
  assert.match(
    picked.setCookie?.find((c) => c.startsWith('theme=')) ?? '',
    /^theme=plum-steel;.*HttpOnly/i,
  )

  // Every page links the theme's stylesheet after style.css.
  const themed = { cookie: `${cookie}; theme=plum-steel` }
  for (const path of ['/', '/Lars/', '/Lars/edit', '/about']) {
    const page = await request('GET', path, '', themed)
    assert.ok(
      page.body.includes(
        `<link rel="stylesheet" href="${stylesheetUrl}"/><link rel="stylesheet" href="/static/themes/plum-steel.css"/>`,
      ),
      path,
    )
  }
  const edit = await request('GET', '/Lars/edit', '', themed)
  assert.match(edit.body, /<input type="radio" name="theme" value="plum-steel" checked/)

  // A cookie that names no theme is the default.
  const bogus = await request('GET', '/', '', { cookie: `${cookie}; theme=../../evil` })
  assert.doesNotMatch(bogus.body, /\/static\/themes\/|evil/)

  // JSON callers get the theme back; unknown themes and anonymous callers are refused.
  const viaJson = await sendJson('/api/theme', { theme: 'forest-alloy' }, { cookie })
  assert.equal(viaJson.statusCode, 200)
  assert.deepEqual(JSON.parse(viaJson.body), { theme: 'forest-alloy' })
  const unknown = await request('POST', '/api/theme', 'theme=neon', { cookie, ...json })
  assert.equal(unknown.statusCode, 400)
  assert.equal((await request('POST', '/api/theme', 'theme=plum-steel')).statusCode, 401)

  // The Markdown edit page says how.
  const markdown = await request('GET', '/Lars/edit', '', { cookie, accept: 'text/markdown' })
  assert.match(markdown.body, /## Theme\n[^]*`POST \/api\/theme`/)
})

test('every theme but the default has its own stylesheet', async () => {
  for (const { id } of themes.slice(1)) {
    const css = await request('GET', `/static/themes/${id}.css`)
    assert.equal(css.statusCode, 200, id)
    assert.match(css.contentType ?? '', /^text\/css/, id)
    assert.match(css.body, /:root \{/, id)
  }
  // The picker's colour strips are in the main stylesheet, one per theme.
  const style = await request('GET', stylesheetUrl)
  for (const { id } of themes) {
    assert.ok(style.body.includes(`.swatch-${id} span`), id)
  }
})

test('every page has the same navigation, with the current page marked', async () => {
  const cookie = await createSession('Lars')
  const nav = (body: string) => /<nav class="top-nav"[^]*?<\/nav>/.exec(body)?.[0] ?? ''

  const anonymous = nav((await request('GET', '/about')).body)
  for (const href of ['/', '/search', '/login', '/createUser']) {
    assert.match(anonymous, new RegExp(`href="${href}"`), href)
  }
  assert.doesNotMatch(anonymous, /href="\/settings"/)

  for (const [path, current] of [
    ['/', '/'],
    ['/everyone', '/everyone'],
    ['/near', '/near'],
    ['/Lars/', '/Lars/'],
    ['/Lars/edit', '/Lars/'],
    ['/settings', '/settings'],
    ['/settings/delete', '/settings'],
  ]) {
    const links = nav((await request('GET', path, '', { cookie })).body)
    for (const href of ['/', '/everyone', '/search', '/near', '/Lars/', '/settings']) {
      assert.match(links, new RegExp(`href="${href}"`), `${path}: ${href}`)
    }
    assert.deepEqual(
      [...links.matchAll(/href="([^"]+)" aria-current="page"/g)].map((match) => match[1]),
      [current],
      path,
    )
  }
})
