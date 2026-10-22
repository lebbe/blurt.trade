import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { embedPendingBlurts } from '../src/embeddings.ts'
import { getUserByUsername } from '../src/routes/state.ts'
import {
  blurtIdByText,
  blurtRow,
  cookiesSet,
  createSession,
  feedWithRefreshToken,
  inviteCodes,
  json,
  placeAt,
  request,
  sendJson,
  setSignupLimits,
  signupCount,
  viewerName,
  withRealRateLimits,
} from './helpers.ts'

// Rows anywhere in the database that still point at the user: by a foreign key to users,
// or by containing the username (case-insensitive) anywhere in the row, which catches
// tables keyed by name, like the waitlist. retired_usernames holds the name on purpose.
// The stub users row and the account's deleted blurts keep the id on purpose too.
async function leftovers(userId: number, username: string): Promise<string[]> {
  const found: string[] = []
  const { rows: references } = await db().query<{ table: string; column: string }>(
    `SELECT c.conrelid::regclass::text AS table, a.attname AS column
     FROM pg_constraint c JOIN pg_attribute a
       ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass`,
  )
  assert.ok(references.length >= 7, 'could not read the foreign keys to users')
  const kept: Record<string, string> = {
    users: 'AND deleted_at IS NULL',
    blurts: 'AND deleted_at IS NULL',
  }
  for (const { table, column } of [...references, { table: 'users', column: 'id' }]) {
    const { rows } = await db().query(
      `SELECT count(*)::int AS count FROM ${table} WHERE ${column} = $1 ${kept[table] ?? ''}`,
      [userId],
    )
    if (rows[0].count > 0) {
      found.push(`${table}.${column}`)
    }
  }
  const { rows: tables } = await db().query<{ table: string }>(
    `SELECT table_name AS table FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name NOT IN ('pgmigrations', 'spatial_ref_sys', 'retired_usernames')`,
  )
  assert.ok(tables.length >= 9, 'could not read the tables')
  for (const { table } of tables) {
    const { rows } = await db().query(
      `SELECT count(*)::int AS count FROM ${table} t WHERE t::text ILIKE '%' || $1 || '%'`,
      [username],
    )
    if (rows[0].count > 0) {
      found.push(`${table} (username)`)
    }
  }
  return found
}

test('deletes an account and everything that refers to it, after asking for the password', async () => {
  const bobCookie = await createSession('Bob')
  const bobCode = (await inviteCodes('Bob', bobCookie))[0].code
  const signedUp = await request(
    'POST',
    '/signup',
    `username=Leaver&password=correct-horse&inviteCode=${bobCode}`,
  )
  assert.equal(signedUp.statusCode, 303)
  const laptop = cookiesSet(signedUp)
  const phone = cookiesSet(
    await request('POST', '/login', 'username=Leaver&password=correct-horse'),
  )
  const cookie = `access_token=${laptop.access_token}`
  const leaverCode = (await inviteCodes('Leaver', cookie))[0].code
  const adaSignUp = await request(
    'POST',
    '/signup',
    `username=Ada&password=correct-horse&inviteCode=${leaverCode}`,
  )
  const ada = `access_token=${cookiesSet(adaSignUp).access_token}`
  const leaverId = (await getUserByUsername('Leaver'))!.id

  await request('POST', '/api/blurts', 'text=Nobody+answers+this', { cookie })
  await request('POST', '/api/blurts', 'text=Popular+take', { cookie })
  const popular = await blurtIdByText('Popular take')
  await request('POST', '/api/blurts', `parentId=${popular}&text=Ada+agrees`, { cookie: ada })
  await request('POST', '/api/blurts', 'text=Ada+speaks', { cookie: ada })
  const adaBlurt = await blurtIdByText('Ada speaks')
  await request('POST', '/api/blurts', `parentId=${adaBlurt}&text=Reply+from+me`, { cookie })
  await request('POST', '/api/follow', 'username=Ada', { cookie })
  await request('POST', '/api/follow', 'username=Leaver', { cookie: ada })
  await request('POST', '/api/follow', 'username=Leaver', { cookie: bobCookie })
  await request('POST', '/api/report', `blurtId=${adaBlurt}&reason=Meh`, { cookie })
  await request('POST', '/api/report', `blurtId=${popular}`, { cookie: ada })
  await request('POST', '/api/like', `blurtId=${adaBlurt}`, { cookie })
  await request('POST', '/api/like', `blurtId=${adaBlurt}`, { cookie: ada })
  await request('POST', '/api/like', `blurtId=${popular}`, { cookie: ada })
  await placeAt('Leaver', 59.5, 10.5)
  await db().query(`INSERT INTO waitlist (username, status) VALUES ('leaver', 'joined')`)
  await embedPendingBlurts()
  const signups = await signupCount()

  // Settings links to the confirmation page, which asks for the password.
  const settings = await request('GET', '/settings', '', { cookie })
  assert.match(settings.body, /href="\/settings\/delete"/)
  const page = await request('GET', '/settings/delete', '', { cookie })
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /<form method="post" action="\/settings\/delete">/)
  assert.match(page.body, /name="password" type="password"/)
  assert.match(page.body, /username is retired/)

  const wrong = await request('POST', '/settings/delete', 'password=wrong-horse', { cookie })
  assert.equal(wrong.statusCode, 400)
  assert.match(wrong.body, /Wrong password\. Your account was not deleted\./)
  const missing = await request('POST', '/settings/delete', '', { cookie })
  assert.equal(missing.statusCode, 400)
  // The check itself finds what it should.
  assert.ok((await leftovers(leaverId, 'leaver')).length > 5)

  const deleted = await request('POST', '/settings/delete', 'password=correct-horse', { cookie })
  assert.equal(deleted.statusCode, 303)
  assert.equal(deleted.location, '/')
  const cleared = cookiesSet(deleted)
  assert.equal(cleared.access_token, '')
  assert.equal(cleared.refresh_token, '')

  assert.deepEqual(await leftovers(leaverId, 'leaver'), [])

  // A stub users row stays: no username, no password, nothing else.
  const { rows: stub } = await db().query(
    'SELECT username, password_hash, deleted_at IS NOT NULL AS deleted FROM users WHERE id = $1',
    [leaverId],
  )
  assert.deepEqual(stub, [{ username: null, password_hash: null, deleted: true }])
  // Their blurts stay as rows, emptied, with user_id kept. None shows an author.
  assert.deepEqual(await blurtRow(popular), {
    user_id: leaverId,
    text: null,
    embedding: null,
    deleted: true,
  })
  const thread = JSON.parse((await request('GET', `/deleted/${popular}`, '', json)).body)
  assert.equal(thread.blurt.username, null)
  assert.equal(thread.blurt.avatar, null)
  assert.deepEqual(
    thread.replies.map((reply: { text: string }) => reply.text),
    ['Ada agrees'],
  )
  const adaThread = JSON.parse((await request('GET', `/Ada/${adaBlurt}`, '', json)).body)
  assert.deepEqual(
    adaThread.replies.map((reply: { username: string; text: string; deleted: boolean }) => [
      reply.username,
      reply.text,
      reply.deleted,
    ]),
    [[null, null, true]],
  )
  const { rows: texts } = await db().query(
    'SELECT text, user_id, deleted_at IS NOT NULL AS deleted FROM blurts ORDER BY id',
  )
  assert.deepEqual(
    texts.map((row) => [row.text, row.deleted]),
    [
      [null, true],
      [null, true],
      ['Ada agrees', false],
      ['Ada speaks', false],
      [null, true],
    ],
  )
  // Reports on and by the deleted account go; Ada's own data stays.
  assert.equal((await db().query('SELECT 1 FROM reports')).rowCount, 0)
  // So do likes by it (off the count) and on its blurts; Ada's like of her own stays.
  const { rows: likes } = await db().query(
    `SELECT b.text, coalesce(s.like_count, 0) AS like_count,
       (SELECT count(*)::int FROM likes l WHERE l.blurt_id = b.id) AS rows
     FROM blurts b LEFT JOIN blurt_stats s ON s.blurt_id = b.id
     WHERE b.deleted_at IS NULL ORDER BY b.id`,
  )
  assert.deepEqual(likes, [
    { text: 'Ada agrees', like_count: 0, rows: 0 },
    { text: 'Ada speaks', like_count: 1, rows: 1 },
  ])
  assert.equal((await db().query('SELECT 1 FROM likes WHERE blurt_id = $1', [popular])).rowCount, 0)
  const adaProfile = JSON.parse((await request('GET', '/Ada/', '', { ...json, cookie: ada })).body)
  assert.equal(adaProfile.invitedBy, null)
  assert.deepEqual(adaProfile.follows, {
    followerCount: 0,
    followingCount: 0,
    viewerFollows: false,
  })
  // The code the deleted account signed up with stays used, linked to nobody.
  const { rows: used } = await db().query(
    'SELECT used_at IS NOT NULL AS used, used_by_user_id FROM invite_codes WHERE code = $1',
    [bobCode],
  )
  assert.deepEqual(used, [{ used: true, used_by_user_id: null }])
  // A sign-up is a sign-up: the count doesn't go down.
  assert.equal(await signupCount(), signups)

  // Every old cookie is rejected: access and refresh tokens, on every device.
  for (const old of [cookie, `access_token=${phone.access_token}`]) {
    assert.equal((await request('GET', '/settings', '', { ...json, cookie: old })).statusCode, 401)
    assert.equal(viewerName(await request('GET', '/', '', { ...json, cookie: old })), null)
  }
  for (const refresh of [laptop.refresh_token, phone.refresh_token]) {
    assert.equal(viewerName(await feedWithRefreshToken(refresh)), null)
  }
  const blurtAfter = await request('POST', '/api/blurts', 'text=Still+here', {
    ...json,
    cookie: `access_token=${laptop.access_token}; refresh_token=${laptop.refresh_token}`,
  })
  assert.equal(blurtAfter.statusCode, 401)
  assert.equal((await request('GET', '/Leaver/')).statusCode, 404)
  const login = await request('POST', '/login', 'username=Leaver&password=correct-horse')
  assert.match(login.body, /Invalid username or password/)

  // The username is retired, in any letter case, for sign-up and the waitlist.
  const again = await request('POST', '/signup', 'username=LEAVER&password=correct-horse')
  assert.equal(again.statusCode, 400)
  assert.match(again.body, /Username is already taken/)
  await setSignupLimits(0, 0)
  const waitlist = await sendJson('/waitlist', { username: 'leaver' })
  assert.deepEqual(JSON.parse(waitlist.body), {
    errors: [{ field: 'username', message: 'Username is already taken' }],
  })
  const { rows: retired } = await db().query('SELECT * FROM retired_usernames')
  assert.deepEqual(retired, [{ username: 'leaver' }])
})

test('account deletion answers JSON and Markdown, needs a login, and is rate limited', async () => {
  const cookie = await createSession('Lars')

  assert.equal((await request('GET', '/settings/delete', '', json)).statusCode, 401)
  const anonymous = await request('POST', '/settings/delete', 'password=correct-horse')
  assert.equal(anonymous.statusCode, 401)
  const data = await request('GET', '/settings/delete', '', { ...json, cookie })
  assert.deepEqual(JSON.parse(data.body), { viewer: { id: 1, username: 'Lars' } })
  const markdown = await request('GET', '/settings/delete', '', { accept: 'text/markdown', cookie })
  assert.match(markdown.body, /^# Delete account: Lars\n[^]*`POST \/settings\/delete`/)
  const settings = await request('GET', '/settings', '', { accept: 'text/markdown', cookie })
  assert.match(settings.body, /\[Delete my account\]\(<\/settings\/delete>\)/)

  await withRealRateLimits(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = await sendJson('/settings/delete', { password: 'wrong-horse' }, { cookie })
      assert.equal(wrong.statusCode, 400)
      assert.deepEqual(JSON.parse(wrong.body), {
        errors: [{ field: 'password', message: 'Wrong password. Your account was not deleted.' }],
      })
    }
    const limited = await sendJson('/settings/delete', { password: 'correct-horse' }, { cookie })
    assert.equal(limited.statusCode, 429)
  })
  assert.ok(await getUserByUsername('Lars'))

  const deleted = await sendJson('/settings/delete', { password: 'correct-horse' }, { cookie })
  assert.equal(deleted.statusCode, 204)
  assert.equal(await getUserByUsername('Lars'), undefined)
  assert.equal((await db().query('SELECT 1 FROM users WHERE deleted_at IS NULL')).rowCount, 0)
  assert.equal((await db().query('SELECT 1 FROM users')).rowCount, 1) // the stub
})
