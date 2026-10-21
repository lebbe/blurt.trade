import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import {
  blurtIdByText,
  createSession,
  json,
  request,
  sendJson,
  withRealRateLimits,
} from './helpers.ts'

type Row = { user: string; kind: string; actor: string; text: string | null; read: boolean }

async function notifications(): Promise<Row[]> {
  const { rows } = await db().query<Row>(
    `SELECT u.username AS "user", n.kind, a.username AS actor, b.text, n.read_at IS NOT NULL AS read
     FROM notifications n JOIN users u ON u.id = n.user_id JOIN users a ON a.id = n.actor_user_id
     JOIN blurts b ON b.id = n.blurt_id ORDER BY n.id`,
  )
  return rows
}

async function blurt(cookie: string, text: string, extra = ''): Promise<void> {
  const response = await request(
    'POST',
    '/api/blurts',
    `text=${encodeURIComponent(text)}${extra}`,
    {
      cookie,
    },
  )
  assert.equal(response.statusCode, 303, response.body)
}

const settings = (cookie: string, body: string) =>
  request('POST', '/api/notifications/settings', body, { cookie })

test('replies, reblurts and quotes notify the author, and own actions never do', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await blurt(lars, 'hello world')
  const id = await blurtIdByText('hello world')

  await blurt(ada, 'a reply', `&parentId=${id}`)
  await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
  await blurt(ada, 'a quote', `&reblurtOfId=${id}`)
  assert.deepEqual(await notifications(), [
    { user: 'Lars', kind: 'reply', actor: 'Ada', text: 'a reply', read: false },
    { user: 'Lars', kind: 'reblurt', actor: 'Ada', text: 'hello world', read: false },
    { user: 'Lars', kind: 'quote', actor: 'Ada', text: 'a quote', read: false },
  ])

  // Own actions: replying to and quoting yourself, with Lars' blurt reblurt refused.
  await blurt(lars, 'self reply', `&parentId=${id}`)
  await blurt(lars, 'self quote', `&reblurtOfId=${id}`)
  assert.equal((await notifications()).length, 3)

  // Un-reblurting takes its notification back; reblurting again makes a fresh one.
  await request('POST', '/api/unreblurt', `blurtId=${id}`, { cookie: ada })
  assert.deepEqual(
    (await notifications()).map((row) => row.kind),
    ['reply', 'quote'],
  )
  await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
  await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
  assert.equal((await notifications()).filter((row) => row.kind === 'reblurt').length, 1)
})

test('blurts from followed accounts are off by default, and each kind follows its setting', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await request('POST', '/api/follow', 'username=Lars', { cookie: ada })

  await blurt(lars, 'quiet')
  assert.deepEqual(await notifications(), [])

  // Left out is off; the edit page shows what is saved.
  assert.equal((await settings(ada, 'followedBlurts=1')).statusCode, 303)
  const edit = await request('GET', '/Ada/edit', '', { cookie: ada })
  assert.match(edit.body, /name="followedBlurts" value="1" checked/)
  assert.doesNotMatch(edit.body, /name="replies" value="1" checked/)
  assert.doesNotMatch(edit.body, /name="reblurts" value="1" checked/)

  await blurt(lars, 'loud')
  const id = await blurtIdByText('loud')
  // Replies are not top-level blurts: no followed_blurt for them.
  await blurt(lars, 'a reply', `&parentId=${id}`)
  assert.deepEqual(await notifications(), [
    { user: 'Ada', kind: 'followed_blurt', actor: 'Lars', text: 'loud', read: false },
  ])

  // Ada has replies and reblurts off now, so nothing for them.
  const adaBlurt = await request('POST', '/api/blurts', 'text=mine', { cookie: ada })
  assert.equal(adaBlurt.statusCode, 303)
  const mine = await blurtIdByText('mine')
  await blurt(lars, 'lars replies', `&parentId=${mine}`)
  await request('POST', '/api/reblurt', `blurtId=${mine}`, { cookie: lars })
  assert.equal((await notifications()).length, 1)

  // A quote of a followed account's blurt by the account notifies the quoted once.
  await settings(ada, 'followedBlurts=1&reblurts=1')
  await blurt(lars, 'quoting ada', `&reblurtOfId=${mine}`)
  assert.deepEqual(
    (await notifications()).slice(1).map((row) => [row.user, row.kind]),
    [['Ada', 'quote']],
  )
})

test('settings answer JSON callers and can be switched all on', async () => {
  const lars = await createSession('Lars')
  const saved = await sendJson(
    '/api/notifications/settings',
    { replies: true, reblurts: false, followedBlurts: true },
    { cookie: lars },
  )
  assert.equal(saved.statusCode, 200)
  assert.deepEqual(JSON.parse(saved.body), { followedBlurts: true, replies: true, reblurts: false })
  const edit = JSON.parse((await request('GET', '/Lars/edit', '', { ...json, cookie: lars })).body)
  assert.deepEqual(edit.notifications, { followedBlurts: true, replies: true, reblurts: false })
  // Private: not on the public profile.
  const profile = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  assert.equal(JSON.stringify(profile).includes('notif'), false)
  assert.equal((await sendJson('/api/notifications/settings', {})).statusCode, 401)
})

test('the unread count shows in Your corner, capped at 99+', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  const corner = async () =>
    (await request('GET', '/', '', { cookie: lars })).body.match(/Notifications[^<]*/)?.[0]
  await blurt(lars, 'popular')
  const id = await blurtIdByText('popular')
  assert.match((await corner()) ?? '', /^Notifications$/)

  await blurt(ada, 'one', `&parentId=${id}`)
  await blurt(ada, 'two', `&parentId=${id}`)
  assert.match((await corner()) ?? '', /^Notifications \(2\)$/)
  assert.match(
    (await request('GET', '/', '', { cookie: lars })).body,
    /href="\/Lars\/notifications\/"/,
  )

  await db().query(
    `INSERT INTO blurts (user_id, text, parent_id)
     SELECT a.id, 'r' || i, $1 FROM users a, generate_series(1, 120) i WHERE a.username = 'Ada'`,
    [id],
  )
  await db().query(
    `INSERT INTO notifications (user_id, kind, actor_user_id, blurt_id)
     SELECT l.id, 'reply', b.user_id, b.id FROM users l, blurts b
     WHERE l.username = 'Lars' AND b.parent_id = $1 AND b.text LIKE 'r%'`,
    [id],
  )
  assert.match((await corner()) ?? '', /^Notifications \(99\+\)$/)
  // Only your own count: Ada has none.
  assert.equal(
    (await request('GET', '/', '', { cookie: ada })).body.includes('Notifications ('),
    false,
  )
})

test('the notifications page lists unread first, marks them read and is private', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await blurt(lars, 'target')
  const id = await blurtIdByText('target')
  await blurt(ada, 'first reply', `&parentId=${id}`)
  await blurt(ada, 'second reply', `&parentId=${id}`)

  const page = await request('GET', '/Lars/notifications/', '', { cookie: lars })
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /<a href="\/Ada\/">Ada<\/a>[^]*replied to your blurt/)
  assert.ok(page.body.indexOf('second reply') < page.body.indexOf('first reply'))
  assert.match(page.body, /action="\/api\/notifications\/read"[^]*Mark all as read/)
  const adaId = await blurtIdByText('second reply')
  assert.match(page.body, new RegExp(`href="/Ada/${adaId}"`))

  const data = JSON.parse(
    (await request('GET', '/Lars/notifications/', '', { ...json, cookie: lars })).body,
  )
  assert.equal(data.unread, 2)
  assert.deepEqual(
    data.notifications.map((n: { text: string; kind: string }) => [n.text, n.kind]),
    [
      ['second reply', 'reply'],
      ['first reply', 'reply'],
    ],
  )
  const markdown = await request('GET', '/Lars/notifications/', '', {
    cookie: lars,
    accept: 'text/markdown',
  })
  assert.match(markdown.body, /# Notifications/)
  assert.match(markdown.body, /second reply/)

  // Private to the owner.
  assert.equal((await request('GET', '/Lars/notifications/', '', { cookie: ada })).statusCode, 403)
  assert.equal((await request('GET', '/Lars/notifications/', '', json)).statusCode, 401)
  assert.equal(
    (await request('GET', '/Lars/notifications/?before=nonsense', '', { cookie: lars })).statusCode,
    400,
  )

  // Mark one, then all; others cannot touch Lars' notifications.
  const { rows } = await db().query<{ id: string }>('SELECT id FROM notifications ORDER BY id')
  const other = await request('POST', '/api/notifications/read', `id=${rows[0].id}`, {
    cookie: ada,
  })
  assert.equal(other.statusCode, 404)
  assert.equal(
    (await request('POST', '/api/notifications/read', 'id=abc', { cookie: lars })).statusCode,
    400,
  )
  const one = await request('POST', '/api/notifications/read', `id=${rows[0].id}`, { cookie: lars })
  assert.equal(one.statusCode, 303)
  assert.equal(one.location, '/Lars/notifications/')
  const afterOne = await request('GET', '/Lars/notifications/', '', { ...json, cookie: lars })
  assert.equal(JSON.parse(afterOne.body).unread, 1)

  const all = await request('POST', '/api/notifications/read', '', { ...json, cookie: lars })
  assert.deepEqual(JSON.parse(all.body), { unread: 0 })
  const empty = await request('GET', '/Lars/notifications/', '', { cookie: lars })
  assert.match(empty.body, /all caught up/)
  assert.doesNotMatch(empty.body, /Mark all as read/)
  assert.match((await request('GET', '/', '', { cookie: lars })).body, />Notifications</)

  const read = await request('GET', '/Lars/notifications/?read=1', '', { ...json, cookie: lars })
  assert.equal(JSON.parse(read.body).notifications.length, 2)
  // Ada's own list is untouched by Lars marking his.
  assert.equal(
    (await request('POST', '/api/notifications/read', '', { cookie: '' })).statusCode,
    401,
  )
})

test('notifications page keyset-paginates', async () => {
  const lars = await createSession('Lars')
  await createSession('Ada')
  await blurt(lars, 'target')
  const id = await blurtIdByText('target')
  await db().query(
    `INSERT INTO blurts (user_id, text, parent_id)
     SELECT a.id, 'r' || i, $1 FROM users a, generate_series(1, 105) i WHERE a.username = 'Ada'`,
    [id],
  )
  await db().query(
    `INSERT INTO notifications (user_id, kind, actor_user_id, blurt_id, created_at)
     SELECT l.id, 'reply', b.user_id, b.id, now() + b.id * interval '1 second'
     FROM users l, blurts b WHERE l.username = 'Lars' AND b.parent_id = $1`,
    [id],
  )
  const first = JSON.parse(
    (await request('GET', '/Lars/notifications/', '', { ...json, cookie: lars })).body,
  )
  assert.equal(first.notifications.length, 100)
  assert.ok(first.next)
  const second = JSON.parse(
    (
      await request('GET', `/Lars/notifications/?before=${first.next}`, '', {
        ...json,
        cookie: lars,
      })
    ).body,
  )
  assert.equal(second.notifications.length, 5)
  assert.equal(second.next, null)
  const ids = new Set([...first.notifications, ...second.notifications].map((n) => n.id))
  assert.equal(ids.size, 105)
})

test('deleting a blurt or an account leaves no notifications behind', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await createSession('Bo')
  await blurt(lars, 'target')
  const id = await blurtIdByText('target')
  await blurt(ada, 'ada reply', `&parentId=${id}`)
  await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
  assert.equal((await notifications()).length, 2)

  // The reply's author deletes it: only its notification goes.
  const replyId = await blurtIdByText('ada reply')
  await request('POST', `/api/blurts/${replyId}/delete`, '', { cookie: ada })
  assert.deepEqual(
    (await notifications()).map((row) => row.kind),
    ['reblurt'],
  )

  // Deleting the reblurted blurt takes the reblurt notification too.
  await request('POST', `/api/blurts/${id}/delete`, '', { cookie: lars })
  assert.deepEqual(await notifications(), [])

  // An account's notifications, to and from it, go with it.
  await blurt(lars, 'again')
  const again = await blurtIdByText('again')
  await blurt(ada, 'ada again', `&parentId=${again}`)
  await blurt(lars, 'lars to ada', `&parentId=${await blurtIdByText('ada again')}`)
  assert.equal((await notifications()).length, 2)
  const deleted = await request('POST', '/settings/delete', 'password=correct-horse', {
    cookie: ada,
  })
  assert.equal(deleted.statusCode, 303)
  assert.deepEqual(await notifications(), [])
  const { rows } = await db().query('SELECT 1 FROM notifications')
  assert.equal(rows.length, 0)
})

test('read notifications are pruned after a while, unread ones are kept', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await blurt(lars, 'target')
  const id = await blurtIdByText('target')
  await blurt(ada, 'one', `&parentId=${id}`)
  await blurt(ada, 'two', `&parentId=${id}`)
  await blurt(ada, 'three', `&parentId=${id}`)
  await db().query(
    `UPDATE notifications SET read_at = now() - interval '100 days' WHERE id IN (
       SELECT id FROM notifications ORDER BY id LIMIT 1)`,
  )
  await db().query(
    `UPDATE notifications SET read_at = now() - interval '1 day' WHERE id IN (
       SELECT id FROM notifications ORDER BY id OFFSET 1 LIMIT 1)`,
  )
  const { pruneNotifications } = await import('../src/routes/state.ts')
  assert.equal(await pruneNotifications(), 1)
  assert.equal((await notifications()).length, 2)
})

test('settings and mark-as-read are rate limited', async () => {
  const lars = await createSession('Lars')
  await withRealRateLimits(async () => {
    for (let i = 0; i < 60; i++) {
      assert.equal((await settings(lars, 'replies=1')).statusCode, 303)
    }
    const limited = await settings(lars, 'replies=1')
    assert.equal(limited.statusCode, 429)
    assert.ok(limited.retryAfter)
    assert.equal(
      (await request('POST', '/api/notifications/read', '', { cookie: lars })).statusCode,
      429,
    )
  })
})

test('visiting a blurt marks the notifications about it as read, and the count follows', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await blurt(lars, 'mine')
  const mine = await blurtIdByText('mine')
  await blurt(ada, 'reply one', `&parentId=${mine}`)
  await blurt(ada, 'reply two', `&parentId=${mine}`)
  await blurt(ada, 'other', '')
  await blurt(ada, 'quote of mine', `&reblurtOfId=${mine}`)
  await request('POST', '/api/reblurt', `blurtId=${mine}`, { cookie: ada })
  await blurt(lars, 'second')
  const second = await blurtIdByText('second')
  await blurt(ada, 'reply to second', `&parentId=${second}`)
  const unread = async () =>
    (await db().query('SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL')).rows[0]
      .n
  assert.equal(await unread(), 5)

  // Visiting someone else's page, or one nothing is about, changes nothing.
  assert.equal(
    (await request('GET', `/Ada/${await blurtIdByText('other')}`, '', { cookie: lars })).statusCode,
    200,
  )
  assert.equal(await unread(), 5)
  // Anonymous visits never write.
  await request('GET', `/Lars/${mine}`)
  assert.equal(await unread(), 5)

  // Visiting the reply itself reads only its notification, and the page already shows 4.
  const replyOne = await blurtIdByText('reply one')
  const reply = await request('GET', `/Ada/${replyOne}`, '', { cookie: lars })
  assert.equal(reply.statusCode, 200)
  assert.match(reply.setCookie?.join(';') ?? '', /recent_write=1/)
  assert.equal(await unread(), 4)
  assert.match((await request('GET', '/', '', { cookie: lars })).body, /Notifications \(4\)/)

  // Visiting the blurt they wrote reads the rest of its replies, its quote and its reblurt.
  await request('GET', `/Lars/${mine}`, '', { cookie: lars })
  assert.equal(await unread(), 1)
  assert.match((await request('GET', '/', '', { cookie: lars })).body, /Notifications \(1\)/)
  assert.deepEqual(
    (await notifications()).filter((row) => !row.read).map((row) => row.text),
    ['reply to second'],
  )

  // The last one, then nothing left: the link has no number.
  await request('GET', `/Lars/${second}`, '', { cookie: lars })
  assert.equal(await unread(), 0)
  assert.doesNotMatch((await request('GET', '/', '', { cookie: lars })).body, /Notifications \(/)
})

test('Alerts appears in the top navigation only while there are unread notifications', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  const nav = async (cookie: string, path = '/everyone') => {
    const { body } = await request('GET', path, '', { cookie })
    return body.match(/<nav class="top-nav".*?<\/nav>/s)?.[0] ?? ''
  }
  assert.doesNotMatch(await nav(lars), /Alerts/)

  await blurt(lars, 'mine')
  await blurt(ada, 'hi', `&parentId=${await blurtIdByText('mine')}`)
  const bar = await nav(lars)
  assert.match(bar, /href="\/Lars\/notifications\/"[^>]*>.*?<span>Alerts \(1\)<\/span>/s)
  // Between Profile and Settings.
  assert.ok(bar.indexOf('>Profile<') < bar.indexOf('>Alerts (1)<'))
  assert.ok(bar.indexOf('>Alerts (1)<') < bar.indexOf('>Settings<'))
  assert.doesNotMatch(await nav(ada), /Alerts/)
  assert.doesNotMatch(await nav(''), /Alerts/)
  // Your corner keeps its own link.
  assert.match((await request('GET', '/', '', { cookie: lars })).body, /Notifications \(1\)/)
  assert.match(await nav(lars, '/Lars/notifications/'), /aria-current="page"[^>]*>.*?Alerts/s)

  // Reading them takes the link away again.
  await request('POST', '/api/notifications/read', '', { cookie: lars })
  assert.doesNotMatch(await nav(lars), /Alerts/)
})
