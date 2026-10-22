import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { getUserByUsername } from '../src/routes/state.ts'
import {
  createSession,
  inviteCodes,
  json,
  request,
  sendJson,
  setSignupLimits,
  signupCount,
} from './helpers.ts'

test('a taken username releases the slot it claimed', async () => {
  // One slot left after Lars. Ada only gets it if the taken name gave it back.
  await setSignupLimits(2, 2)
  await createSession('Lars')
  const taken = await sendJson('/signup', { username: 'lars', password: 'correct-horse' })
  assert.equal(taken.statusCode, 400)
  assert.equal(await signupCount(), 1)

  const created = await sendJson('/signup', { username: 'Ada', password: 'correct-horse' })
  assert.equal(created.statusCode, 201)
  assert.equal(await signupCount(), 2)
})

test('at the soft limit, sign-up needs an invite', async () => {
  await setSignupLimits(1, 10)
  await createSession('Lars')

  const form = await request('GET', '/signup')
  assert.match(form.body, /invite-only/)
  assert.match(form.body, /<input name="inviteCode"[^>]* required/)
  const data = JSON.parse((await request('GET', '/signup', '', json)).body)
  assert.equal(data.signup, 'invite')
  const markdown = await request('GET', '/signup', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /invite-only/)

  const refused = await request('POST', '/signup', 'username=Ada&password=correct-horse')
  assert.equal(refused.statusCode, 403)
  assert.match(refused.body, /role="alert">blurt\.trade is invite-only/)
  const refusedJson = await sendJson('/signup', { username: 'Ada', password: 'correct-horse' })
  assert.equal(refusedJson.statusCode, 403)
  assert.match(JSON.parse(refusedJson.body).errors[0].message, /invite-only/)
  assert.equal(await getUserByUsername('Ada'), undefined)
  assert.equal(await signupCount(), 1)

  const waitlist = await request('POST', '/waitlist', 'username=Ada')
  assert.equal(waitlist.statusCode, 403)
})

test('at the hard limit, sign-up closes and the waitlist takes a username only', async () => {
  await setSignupLimits(1, 1)
  await createSession('Lars')

  const form = await request('GET', '/signup')
  assert.match(form.body, /Sign-up is full/)
  assert.match(form.body, /action="\/waitlist"/)
  assert.doesNotMatch(form.body, /action="\/signup"/)
  const refused = await request('POST', '/signup', 'username=Ada&password=correct-horse')
  assert.equal(refused.statusCode, 403)
  assert.match(refused.body, /Join the waitlist instead/)
  assert.match(refused.body, /action="\/waitlist"/)

  const joined = await request('POST', '/waitlist', 'username=Ada')
  assert.equal(joined.statusCode, 303)
  assert.equal(joined.location, '/waitlist?username=Ada')
  const again = await sendJson('/waitlist', { username: 'ada' })
  assert.equal(again.statusCode, 201)
  assert.equal(JSON.parse(again.body).username, 'Ada')
  assert.equal(JSON.parse(again.body).status, 'waiting')

  const page = await request('GET', '/waitlist?username=ada')
  assert.match(page.body, /Ada is on the waitlist/)
  assert.match(page.body, /1 person waiting/)
  assert.match(page.body, /When it opens again/)
  const unknown = await request('GET', '/waitlist?username=Bob')
  assert.match(unknown.body, /Bob isn(&#39;|')t on the waitlist/)

  const taken = await sendJson('/waitlist', { username: 'LARS' })
  assert.equal(taken.statusCode, 400)
  const reserved = await sendJson('/waitlist', { username: 'login' })
  assert.equal(reserved.statusCode, 400)

  // Raising the limits reopens sign-up, and the waitlist page says so.
  await db().query('UPDATE signup_counter SET soft_limit = 10, hard_limit = 10')
  assert.match((await request('GET', '/waitlist?username=Ada')).body, /Sign-up is open again/)
  await createSession('Ada')
  const done = JSON.parse((await request('GET', '/waitlist?username=Ada', '', json)).body)
  assert.equal(done.entry.status, 'joined')
  assert.equal(done.waiting, 0)
})

test('the waitlist is closed while sign-up is open', async () => {
  const response = await sendJson('/waitlist', { username: 'Ada' })
  assert.equal(response.statusCode, 403)
  assert.match(JSON.parse(response.body).errors[0].message, /Sign-up is open/)
})

test('concurrent sign-ups never pass the hard limit', async () => {
  await setSignupLimits(5, 5)
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      sendJson('/signup', { username: `racer${i}`, password: 'correct-horse' }),
    ),
  )

  const statuses = responses.map((response) => response.statusCode)
  assert.equal(statuses.filter((status) => status === 201).length, 5)
  assert.equal(statuses.filter((status) => status === 403).length, 15)
  const { rows } = await db().query('SELECT count(*)::int AS count FROM users')
  assert.equal(rows[0].count, 5)
  assert.equal(await signupCount(), 5)
})

test('new users get invite codes that only they can see', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const codes = await inviteCodes('Lars', larsCookie)
  assert.equal(codes.length, 3)
  for (const { code, usedBy } of codes) {
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/)
    assert.equal(usedBy, null)
  }
  const own = await request('GET', '/Lars/', '', { cookie: larsCookie })
  assert.match(own.body, /Your invite codes/)
  assert.ok(own.body.includes(`href="/signup?invite=${codes[0].code}"`))
  const markdown = await request('GET', '/Lars/', '', {
    accept: 'text/markdown',
    cookie: larsCookie,
  })
  assert.match(markdown.body, /## Your invite codes\n[^]*sign-up link/)

  for (const headers of [{ cookie: adaCookie }, {}]) {
    const other = await request('GET', '/Lars/', '', headers)
    assert.doesNotMatch(other.body, /invite codes|signup\?invite/)
    const data = JSON.parse((await request('GET', '/Lars/', '', { ...json, ...headers })).body)
    assert.equal(data.inviteCodes, null)
  }
})

test('invite-only sign-up works end to end, and each code works once', async () => {
  await setSignupLimits(1, 10)
  const larsCookie = await createSession('Lars')
  const [{ code }, second] = await inviteCodes('Lars', larsCookie)

  // The shared link fills in the code.
  const form = await request('GET', `/signup?invite=${code}`)
  assert.match(form.body, new RegExp(`name="inviteCode"[^>]* value="${code}"`))
  const data = JSON.parse((await request('GET', `/signup?invite=${code}`, '', json)).body)
  assert.equal(data.inviteCode, code)
  const markdown = await request('GET', '/signup', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /invite-only[^]*`POST \/signup`[^]*`inviteCode`/)

  // Typed in lower case with a dash still works.
  const typed = `${code.slice(0, 6)}-${code.slice(6)}`.toLowerCase()
  const created = await request(
    'POST',
    '/signup',
    `username=Ada&password=correct-horse&inviteCode=${typed}`,
  )
  assert.equal(created.statusCode, 303)
  assert.equal(await signupCount(), 2)
  assert.match((await request('GET', '/Ada/')).body, /Invited by <a href="\/Lars\/">Lars<\/a>/)
  assert.equal(JSON.parse((await request('GET', '/Ada/', '', json)).body).invitedBy, 'Lars')
  const used = (await inviteCodes('Lars', larsCookie)).find((invite) => invite.code === code)
  assert.equal(used?.usedBy, 'Ada')
  assert.match((await request('GET', '/Lars/', '', { cookie: larsCookie })).body, /used by/)

  // Used, unknown, malformed and expired codes are refused and give the slot back.
  await db().query('UPDATE invite_codes SET expires_at = now() WHERE code = $1', [second.code])
  for (const inviteCode of [code, 'ABCDEFGHJKMN', 'nope', second.code]) {
    const refused = await sendJson('/signup', {
      username: 'Bob',
      password: 'correct-horse',
      inviteCode,
    })
    assert.equal(refused.statusCode, 400, inviteCode)
    assert.equal(JSON.parse(refused.body).errors[0].field, 'inviteCode')
  }
  const html = await request(
    'POST',
    '/signup',
    `username=Bob&password=correct-horse&inviteCode=${code}`,
  )
  assert.match(html.body, /role="alert">That invite code doesn(&#39;|')t exist/)
  assert.match(html.body, /value="Bob"/)
  assert.equal(await getUserByUsername('Bob'), undefined)
  assert.equal(await signupCount(), 2)
})

test('two sign-ups with the same code at the same moment: only one gets in', async () => {
  await setSignupLimits(1, 100)
  const [{ code }] = await inviteCodes('Lars', await createSession('Lars'))

  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      sendJson('/signup', {
        username: `racer${i}`,
        password: 'correct-horse',
        inviteCode: code,
      }),
    ),
  )

  const statuses = responses.map((response) => response.statusCode)
  assert.equal(statuses.filter((status) => status === 201).length, 1)
  assert.equal(statuses.filter((status) => status === 400).length, 9)
  const { rows } = await db().query('SELECT count(*)::int AS count FROM users')
  assert.equal(rows[0].count, 2)
  assert.equal(await signupCount(), 2)
})

test('an invite code does not get past the hard limit', async () => {
  await setSignupLimits(1, 1)
  const larsCookie = await createSession('Lars')
  const [{ code }] = await inviteCodes('Lars', larsCookie)

  const refused = await sendJson('/signup', {
    username: 'Ada',
    password: 'correct-horse',
    inviteCode: code,
  })
  assert.equal(refused.statusCode, 403)
  assert.match(JSON.parse(refused.body).errors[0].message, /waitlist/)
  assert.ok((await inviteCodes('Lars', larsCookie)).every((invite) => invite.usedBy === null))
})

test('open sign-up takes an optional invite code', async () => {
  const [{ code }] = await inviteCodes('Lars', await createSession('Lars'))
  assert.match((await request('GET', '/signup')).body, /Invite code \(optional\)/)

  const created = await sendJson('/signup', {
    username: 'Ada',
    password: 'correct-horse',
    inviteCode: code,
  })
  assert.equal(created.statusCode, 201)
  assert.equal(JSON.parse((await request('GET', '/Ada/', '', json)).body).invitedBy, 'Lars')
})
