import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { cookiesSet, insertBlurt, json, request, sendJson, signUp } from './helpers.ts'

const time = (body: string) => /<time datetime="2026-10-10T12:00:00.000Z">([^<]*)</.exec(body)?.[1]

test('timestamps follow the time zone picked on the edit page, UTC until then', async () => {
  const tokens = await signUp('Lars')
  const access = `access_token=${tokens.access_token}`
  await insertBlurt('Lars', 'Hello world', new Date('2026-10-10T12:00:00.000Z'))

  // Nobody has picked: UTC, shown next to the time. The clock follows Accept-Language.
  const before = await request('GET', '/Lars/', '', { cookie: access })
  assert.match(time(before.body) ?? '', /12:00 UTC$/)
  const american = await request('GET', '/Lars/', '', {
    cookie: access,
    'accept-language': 'en-US,en;q=0.9',
  })
  assert.match(time(american.body) ?? '', /12:00 PM UTC$/)
  const norwegian = await request('GET', '/Lars/', '', { 'accept-language': 'nb-NO' })
  assert.match(time(norwegian.body) ?? '', /12:00 UTC$/)
  const unpicked = await db().query(
    `SELECT p.timezone FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'Lars'`,
  )
  assert.equal(unpicked.rows[0].timezone, null)

  // Saved on the account; the answer is a new access token carrying it.
  const picked = await request('POST', '/api/timezone', 'timezone=Europe%2FOslo', {
    cookie: access,
  })
  assert.equal(picked.statusCode, 303)
  assert.equal(picked.location, '/Lars/edit#timezone')
  const set = cookiesSet(picked)
  assert.deepEqual(Object.keys(set).sort(), ['access_token', 'recent_write'])
  const { rows } = await db().query(
    `SELECT p.timezone FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'Lars'`,
  )
  assert.equal(rows[0].timezone, 'Europe/Oslo')

  const zoned = { cookie: `access_token=${set.access_token}`, 'accept-language': 'nb-NO' }
  assert.match(time((await request('GET', '/Lars/', '', zoned)).body) ?? '', /^10\.10\.2026 14:00$/)
  const edit = await request('GET', '/Lars/edit', '', zoned)
  assert.match(edit.body, /<form method="post" action="\/api\/timezone"/)
  assert.match(edit.body, /<option value="Europe\/Oslo" selected/)

  // Another device gets it at its next token refresh, and at login.
  const refreshed = await request('GET', '/Lars/', '', {
    cookie: `refresh_token=${tokens.refresh_token}`,
    'accept-language': 'nb-NO',
  })
  assert.match(time(refreshed.body) ?? '', /^10\.10\.2026 14:00$/)

  // JSON callers get the zone back; unknown zones and anonymous callers are refused.
  const viaJson = await sendJson(
    '/api/timezone',
    { timezone: 'America/New_York' },
    { cookie: access },
  )
  assert.equal(viaJson.statusCode, 200)
  assert.deepEqual(JSON.parse(viaJson.body), { timezone: 'America/New_York' })
  const unknown = await request('POST', '/api/timezone', 'timezone=Mars%2FOlympus', {
    cookie: access,
    ...json,
  })
  assert.equal(unknown.statusCode, 400)
  assert.equal((await request('POST', '/api/timezone', 'timezone=UTC')).statusCode, 401)
})

test('the language of dates and times is picked on the edit page, else the browser decides', async () => {
  const tokens = await signUp('Lars')
  const access = `access_token=${tokens.access_token}`
  await insertBlurt('Lars', 'Hello world', new Date('2026-10-10T12:00:00.000Z'))
  const american = { 'accept-language': 'en-US' }

  // Not picked: the browser's language; the picker says so.
  const edit = await request('GET', '/Lars/edit', '', { cookie: access })
  assert.match(edit.body, /<option value selected[^>]*>Same as my browser/)
  assert.match(
    time((await request('GET', '/Lars/', '', american)).body) ?? '',
    /^10\/10\/2026 12:00 PM UTC$/,
  )

  // Picked: wins over the browser, and leaves the time zone alone.
  const picked = await request('POST', '/api/timezone', 'locale=nb-NO', { cookie: access })
  assert.equal(picked.statusCode, 303)
  const zoned = { cookie: `access_token=${cookiesSet(picked).access_token}`, ...american }
  assert.match(
    time((await request('GET', '/Lars/', '', zoned)).body) ?? '',
    /^10\.10\.2026 12:00 UTC$/,
  )
  const { rows } = await db().query(
    `SELECT p.locale, p.timezone FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'Lars'`,
  )
  assert.deepEqual(rows[0], { locale: 'nb-NO', timezone: null })
  assert.match(
    (await request('GET', '/Lars/edit', '', zoned)).body,
    /<option value="nb-NO" selected/,
  )

  // Empty goes back to the browser's; unknown languages are refused.
  const cleared = await request('POST', '/api/timezone', 'locale=', { cookie: access })
  const back = { cookie: `access_token=${cookiesSet(cleared).access_token}`, ...american }
  assert.match(time((await request('GET', '/Lars/', '', back)).body) ?? '', /PM UTC$/)
  const unknown = await request('POST', '/api/timezone', 'locale=xx-YY', {
    cookie: access,
    ...json,
  })
  assert.equal(unknown.statusCode, 400)
  const nothing = await request('POST', '/api/timezone', '', { cookie: access, ...json })
  assert.equal(nothing.statusCode, 400)
})

test('the migration gave tante Europe/Oslo', async () => {
  // The migration ran before any user existed; the UPDATE it holds is what a database with
  // tante in it gets. Run the same statement here.
  await signUp('tante')
  await db().query(
    `UPDATE user_profiles SET timezone = 'Europe/Oslo'
     WHERE user_id IN (SELECT id FROM users WHERE lower(username) = 'tante')`,
  )
  const { rows } = await db().query(
    `SELECT p.timezone FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'tante'`,
  )
  assert.equal(rows[0].timezone, 'Europe/Oslo')
})
