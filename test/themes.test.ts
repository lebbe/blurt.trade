import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { stylesheetUrl } from '../src/templates/layout.ts'
import { themes } from '../src/themes.ts'
import { cookiesSet, createSession, json, request, sendJson, signUp } from './helpers.ts'

const plumSteel = `<link rel="stylesheet" href="${stylesheetUrl}"/><link rel="stylesheet" href="/static/themes/plum-steel.css"/>`

test('picks a colour theme on the edit page, saved on the account and carried in the access token', async () => {
  const tokens = await signUp('Lars')
  const access = `access_token=${tokens.access_token}`

  // Nobody has picked yet: the default theme, which is style.css alone.
  const before = await request('GET', '/Lars/edit', '', { cookie: access })
  assert.match(before.body, /<form method="post" action="\/api\/theme"/)
  assert.match(before.body, /<input type="radio" name="theme" value="cobalt-quietude" checked/)
  assert.doesNotMatch(before.body, /\/static\/themes\//)
  const unpicked = await db().query(
    `SELECT p.theme FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'Lars'`,
  )
  assert.equal(unpicked.rows[0].theme, null) // follows the default, should it change

  // Saved on the account; the answer is a new access token carrying it, and no other cookie.
  const picked = await request('POST', '/api/theme', 'theme=plum-steel', { cookie: access })
  assert.equal(picked.statusCode, 303)
  assert.equal(picked.location, '/Lars/edit#theme')
  const set = cookiesSet(picked)
  assert.deepEqual(Object.keys(set).sort(), ['access_token', 'recent_write'])
  const { rows } = await db().query(
    `SELECT p.theme FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'Lars'`,
  )
  assert.equal(rows[0].theme, 'plum-steel')

  // Every page links the theme's stylesheet after style.css, with no database read for it.
  const themed = { cookie: `access_token=${set.access_token}` }
  for (const path of ['/', '/Lars/', '/Lars/edit', '/about']) {
    assert.ok((await request('GET', path, '', themed)).body.includes(plumSteel), path)
  }
  const edit = await request('GET', '/Lars/edit', '', themed)
  assert.match(edit.body, /<input type="radio" name="theme" value="plum-steel" checked/)

  // Another device gets it at its next token refresh, and at login.
  const refreshed = await request('GET', '/about', '', {
    cookie: `refresh_token=${tokens.refresh_token}`,
  })
  assert.ok(refreshed.body.includes(plumSteel))
  const login = await request('POST', '/login', 'username=Lars&password=correct-horse')
  const fresh = `access_token=${cookiesSet(login).access_token}`
  assert.ok((await request('GET', '/about', '', { cookie: fresh })).body.includes(plumSteel))

  // Anonymous visitors get the default.
  assert.doesNotMatch((await request('GET', '/about')).body, /\/static\/themes\//)

  // JSON callers get the theme back; unknown themes and anonymous callers are refused,
  // and the database refuses an unknown theme too.
  const viaJson = await sendJson('/api/theme', { theme: 'forest-alloy' }, { cookie: access })
  assert.equal(viaJson.statusCode, 200)
  assert.deepEqual(JSON.parse(viaJson.body), { theme: 'forest-alloy' })
  const unknown = await request('POST', '/api/theme', 'theme=neon', { cookie: access, ...json })
  assert.equal(unknown.statusCode, 400)
  assert.equal((await request('POST', '/api/theme', 'theme=plum-steel')).statusCode, 401)
  await assert.rejects(db().query(`UPDATE user_profiles SET theme = 'neon'`), /theme_valid/)

  // The Markdown edit page says which and how.
  const markdown = await request('GET', '/Lars/edit', '', {
    cookie: fresh,
    accept: 'text/markdown',
  })
  assert.match(markdown.body, /## Theme\n\nYours: `plum-steel`\.[^]*`POST \/api\/theme`/)
})

test('every theme but the default has its own stylesheet', async () => {
  for (const { id } of themes.slice(1)) {
    const css = await request('GET', `/static/themes/${id}.css`)
    assert.equal(css.statusCode, 200, id)
    assert.match(css.contentType ?? '', /^text\/css/, id)
    assert.match(css.body, /:root \{/, id)
  }
  // The inline above-the-fold colours are the theme's own.
  for (const { id, colors } of themes) {
    const path = id === themes[0].id ? stylesheetUrl : `/static/themes/${id}.css`
    const css = (await request('GET', path)).body
    for (const [name, variable] of [
      ['bg', '--bg'],
      ['text', '--text'],
      ['link', '--accent-strong'],
      ['panel', '--panel'],
      ['line', '--line'],
    ] as const) {
      assert.ok(css.includes(`${variable}: ${colors[name]};`), `${id} ${variable}`)
    }
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
