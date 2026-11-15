import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { blurtIdByText, createSession, json, request, sendJson } from './helpers.ts'

// Makes a bot owned by the session's user, and a token for it.
async function makeBot(cookie: string, username = 'Robo'): Promise<string> {
  const made = await sendJson('/settings/bots', { username }, { cookie })
  assert.equal(made.statusCode, 201, made.body)
  const minted = await sendJson(`/api/bots/${username}/tokens`, { name: 'laptop' }, { cookie })
  assert.equal(minted.statusCode, 201, minted.body)
  const { token } = JSON.parse(minted.body)
  assert.match(token, /^blurt_/)
  return token
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

function v1(method: string, path: string, token: string, body?: unknown) {
  return body === undefined
    ? request(method, path, '', bearer(token))
    : request(method, path, JSON.stringify(body), {
        ...bearer(token),
        'content-type': 'application/json',
      })
}

test('a person makes a bot, which blurts and reacts through /api/v1/ with its token', async () => {
  const lars = await createSession('Lars')
  await createSession('Ada')
  await sendJson('/api/blurts', { text: 'hello from Ada' }, { cookie: await createSession('Ada2') })
  const token = await makeBot(lars)

  const me = await v1('GET', '/api/v1/me', token)
  assert.equal(me.statusCode, 200)
  assert.match(me.contentType ?? '', /json/)
  assert.equal(JSON.parse(me.body).profile.username, 'Robo')
  assert.equal(JSON.parse(me.body).profile.avatar.robot, true)
  assert.deepEqual(JSON.parse(me.body).botOwners, ['Lars'])

  const posted = await v1('POST', '/api/v1/blurts', token, { text: 'beep boop' })
  assert.equal(posted.statusCode, 201, posted.body)
  const id = JSON.parse(posted.body).id
  assert.equal(posted.location, `/Robo/${id}`)

  const reply = await v1('POST', '/api/v1/blurts', token, { text: 'a reply', parentId: id })
  assert.equal(reply.statusCode, 201)
  const thread = await v1('GET', `/api/v1/blurts/${id}`, token)
  assert.equal(thread.statusCode, 200)
  assert.equal(JSON.parse(thread.body).replies[0].text, 'a reply')

  const other = await blurtIdByText('hello from Ada')
  const liked = await v1('PUT', `/api/v1/blurts/${other}/like`, token)
  assert.deepEqual(JSON.parse(liked.body), { blurtId: other, likeCount: 1, viewerLikes: true })
  const unliked = await v1('DELETE', `/api/v1/blurts/${other}/like`, token)
  assert.equal(JSON.parse(unliked.body).likeCount, 0)
  assert.equal((await v1('PUT', `/api/v1/blurts/${other}/reblurt`, token)).statusCode, 200)

  const followed = await v1('PUT', '/api/v1/users/Ada/follow', token)
  assert.equal(JSON.parse(followed.body).followerCount, 1)
  assert.equal((await v1('DELETE', '/api/v1/users/Ada/follow', token)).statusCode, 200)

  const feed = await v1('GET', '/api/v1/feed/everyone', token)
  assert.ok(
    JSON.parse(feed.body).blurts.some((blurt: { text: string }) => blurt.text === 'beep boop'),
  )

  // Errors are JSON too, whatever the client asks for.
  const missing = await request('GET', '/api/v1/blurts/999999', '', {
    ...bearer(token),
    accept: 'text/html',
  })
  assert.equal(missing.statusCode, 404)
  assert.match(missing.contentType ?? '', /json/)
  assert.equal((await v1('GET', '/api/v1/nothing-here', token)).statusCode, 404)

  assert.equal((await v1('DELETE', `/api/v1/blurts/${id}`, token)).statusCode, 204)
})

test('the bot shows as a robot with a Bot label, and nobody can log in as it', async () => {
  const lars = await createSession('Lars')
  const token = await makeBot(lars)
  await v1('POST', '/api/v1/blurts', token, { text: 'i am a robot' })

  const page = await request('GET', '/everyone')
  assert.match(page.body, /class="avatar avatar-small avatar-robot"/)
  assert.match(page.body, /class="bot-label">Bot</)
  assert.match((await request('GET', '/Robo/')).body, /run by[^]*href="\/Lars\/"/)

  const login = await request('POST', '/login', 'username=Robo&password=anything-at-all')
  assert.equal(login.statusCode, 400)
  const { rows } = await db().query('SELECT password_hash FROM users WHERE username = $1', ['Robo'])
  assert.equal(rows[0].password_hash, null)
})

test('/api/v1/ takes bearer tokens only, and tokens work nowhere else', async () => {
  const lars = await createSession('Lars')
  const token = await makeBot(lars)

  const noToken = await request('GET', '/api/v1/me')
  assert.equal(noToken.statusCode, 401)
  assert.equal(noToken.headers['www-authenticate'], 'Bearer')
  assert.equal((await request('GET', '/api/v1/me', '', { cookie: lars })).statusCode, 401)
  assert.equal((await v1('GET', '/api/v1/me', 'blurt_not-a-token')).statusCode, 401)

  // A person's routes don't take the token: there the request is anonymous.
  const page = await sendJson('/api/blurts', { text: 'sneaky' }, bearer(token))
  assert.equal(page.statusCode, 401)
  const settings = await sendJson('/api/bots/Robo/tokens', { name: 'more' }, bearer(token))
  assert.equal(settings.statusCode, 401)
})

test('owners revoke tokens, share the bot, leave it, and delete it', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  const stranger = await createSession('Eve')
  const token = await makeBot(lars)

  // Strangers can't see or touch it.
  assert.equal(
    (await request('GET', '/settings/bots/Robo', '', { ...json, cookie: stranger })).statusCode,
    404,
  )
  assert.equal(
    (await sendJson('/api/bots/Robo/tokens', { name: 'x' }, { cookie: stranger })).statusCode,
    404,
  )

  // The last owner can't leave.
  const alone = await sendJson(
    '/api/bots/Robo/owners/remove',
    { username: 'Lars' },
    { cookie: lars },
  )
  assert.equal(alone.statusCode, 400)

  // Hand it over: share, then leave.
  assert.equal(
    (await sendJson('/api/bots/Robo/owners', { username: 'Ada' }, { cookie: lars })).statusCode,
    200,
  )
  assert.equal(
    (await sendJson('/api/bots/Robo/owners', { username: 'Robo' }, { cookie: lars })).statusCode,
    400,
  )
  const left = await sendJson(
    '/api/bots/Robo/owners/remove',
    { username: 'Lars' },
    { cookie: lars },
  )
  assert.equal(left.statusCode, 204)
  assert.equal(
    (await request('GET', '/settings/bots/Robo', '', { ...json, cookie: lars })).statusCode,
    404,
  )
  const data = JSON.parse(
    (await request('GET', '/settings/bots/Robo', '', { ...json, cookie: ada })).body,
  )
  assert.deepEqual(data.bot.owners, ['Ada'])
  assert.equal(data.tokens.length, 1)

  // The avatar is the owners' to set.
  const avatar = await sendJson('/api/bots/Robo/avatar', { random: true }, { cookie: ada })
  assert.equal(JSON.parse(avatar.body).avatar.robot, true)

  // So is the bio, validated as on the edit page.
  const bio = await sendJson('/api/bots/Robo/bio', { bio: 'Beep boop.' }, { cookie: ada })
  assert.deepEqual(JSON.parse(bio.body), { bio: 'Beep boop.' })
  const profile = await request('GET', '/Robo/', '', json)
  assert.equal(JSON.parse(profile.body).profile.bio, 'Beep boop.')
  const long = await sendJson('/api/bots/Robo/bio', { bio: 'x'.repeat(4001) }, { cookie: ada })
  assert.ok(long.statusCode >= 400 && long.statusCode < 500)

  const revoked = await sendJson(
    `/api/bots/Robo/tokens/${data.tokens[0].id}/revoke`,
    {},
    { cookie: ada },
  )
  assert.equal(revoked.statusCode, 204)
  assert.equal((await v1('GET', '/api/v1/me', token)).statusCode, 401)

  const second = JSON.parse(
    (await sendJson('/api/bots/Robo/tokens', { name: 'b' }, { cookie: ada })).body,
  )
  assert.equal((await sendJson('/api/bots/Robo/delete', {}, { cookie: ada })).statusCode, 204)
  assert.equal((await v1('GET', '/api/v1/me', second.token)).statusCode, 401)
  assert.equal((await request('GET', '/Robo/', '', json)).statusCode, 404)
})

test('admins set a bot owner', async () => {
  const lars = await createSession('Lars')
  const admin = await createSession('Boss')
  await db().query("UPDATE users SET is_admin = true WHERE username = 'Boss'")
  await makeBot(lars)
  await createSession('Ada')

  assert.equal(
    (await sendJson('/api/admin/bots/owner', { bot: 'Robo', owner: 'Ada' }, { cookie: lars }))
      .statusCode,
    403,
  )
  const set = await sendJson(
    '/api/admin/bots/owner',
    { bot: 'Robo', owner: 'Ada' },
    { cookie: admin },
  )
  assert.equal(set.statusCode, 200)
  const profile = JSON.parse((await request('GET', '/Robo/', '', json)).body)
  assert.deepEqual(profile.botOwners, ['Ada'])
})

test('deleting an account deletes the bots only it owned', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  const solo = await makeBot(lars, 'Solo')
  const shared = await makeBot(lars, 'Shared')
  await sendJson('/api/bots/Shared/owners', { username: 'Ada' }, { cookie: lars })

  const deleted = await sendJson(
    '/settings/delete',
    { password: 'correct-horse' },
    { cookie: lars },
  )
  assert.equal(deleted.statusCode, 204)
  assert.equal((await v1('GET', '/api/v1/me', solo)).statusCode, 401)
  assert.equal((await v1('GET', '/api/v1/me', shared)).statusCode, 200)
  const data = JSON.parse(
    (await request('GET', '/settings/bots/Shared', '', { ...json, cookie: ada })).body,
  )
  assert.deepEqual(data.bot.owners, ['Ada'])
})

test('"Hide bots" hides bots you don\'t follow, and their notifications', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  const token = await makeBot(lars)
  await sendJson('/api/blurts', { text: 'ada says hi' }, { cookie: ada })
  await v1('POST', '/api/v1/blurts', token, { text: 'bot says hi' })

  const hidden = await sendJson('/api/hide-bots', { hideBots: true }, { cookie: ada })
  assert.deepEqual(JSON.parse(hidden.body), { hideBots: true })

  const texts = async () =>
    JSON.parse((await request('GET', '/everyone', '', { ...json, cookie: ada })).body).blurts.map(
      (blurt: { text: string }) => blurt.text,
    )
  assert.deepEqual(await texts(), ['ada says hi'])
  // Others still see it.
  const forLars = JSON.parse(
    (await request('GET', '/everyone', '', { ...json, cookie: lars })).body,
  )
  assert.equal(forLars.blurts.length, 2)

  // A reply from the bot: hidden in the thread, and no notification.
  const adaBlurt = await blurtIdByText('ada says hi')
  await v1('POST', '/api/v1/blurts', token, { text: 'bot replies', parentId: adaBlurt })
  const thread = JSON.parse(
    (await request('GET', `/Ada/${adaBlurt}`, '', { ...json, cookie: ada })).body,
  )
  assert.deepEqual(thread.replies, [])
  const { rows } = await db().query(
    "SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = 'Ada'",
  )
  assert.equal(rows[0].n, 0)

  // Following wins.
  await sendJson('/api/follow', { username: 'Robo' }, { cookie: ada })
  assert.deepEqual((await texts()).sort(), ['ada says hi', 'bot says hi'])
})

test('the bot pages, settings and /about render as HTML and Markdown', async () => {
  const lars = await createSession('Lars')
  await makeBot(lars)
  for (const path of ['/settings', '/settings/bots', '/settings/bots/Robo']) {
    const page = await request('GET', path, '', { cookie: lars })
    assert.equal(page.statusCode, 200, path)
    const markdown = await request('GET', path, '', { cookie: lars, accept: 'text/markdown' })
    assert.equal(markdown.statusCode, 200, path)
  }
  const bot = await request('GET', '/settings/bots/Robo', '', { cookie: lars })
  assert.match(bot.body, /action="\/api\/bots\/Robo\/avatar"[^>]*data-robot="true"/)
  assert.match(bot.body, />Antenna</)
  const minted = await request('POST', '/api/bots/Robo/tokens', 'name=phone', { cookie: lars })
  assert.equal(minted.statusCode, 201)
  assert.match(minted.body, /<code>blurt_[\w-]+<\/code>/)
  assert.match((await request('GET', '/about')).body, /GET \/api\/v1\/feed/)
})
