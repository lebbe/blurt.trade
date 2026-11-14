import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importJWK, jwtVerify } from 'jose'
import { configProblems } from '../src/config.ts'
import { db } from '../src/db.ts'
import {
  isPushEndpoint,
  pushesSettled,
  pushIntervalSeconds,
  setPushIntervalSeconds,
  setTestPushOrigins,
  vapidKeys,
} from '../src/push.ts'
import { generateVapidKeys, vapidProblem } from '../src/vapid.ts'
import { serviceWorkerContentSecurityPolicy } from '../src/routes/push.ts'
import { notificationVerbs } from '../src/ui/notifications.ts'
import { blurtIdByText, createSession, json, request, sendJson } from './helpers.ts'

// Web Push (src/push.ts, src/routes/push.ts). Pushes go to a fake push service: an http
// server in this test, never a real one.

const keys = generateVapidKeys()

// VAPID keys for one test only (tests share the process).
function withVapid(t: TestContext): void {
  const before = { ...process.env }
  process.env.VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey
  process.env.VAPID_SUBJECT = 'mailto:push@example.com'
  t.after(() => {
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      if (before[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = before[name]
      }
    }
  })
}

type Received = { path: string; headers: http.IncomingHttpHeaders; body: string; at: number }

// A push service that answers each push with `status` (201 by default) and records it.
async function fakePushService(t: TestContext) {
  const received: Received[] = []
  let status = 201
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body, at: Date.now() })
      res.writeHead(status).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  setTestPushOrigins([origin])
  t.after(() => {
    setTestPushOrigins([])
    server.close()
  })
  return {
    origin,
    received,
    answer: (code: number) => {
      status = code
    },
  }
}

// A subscription as PushSubscription.toJSON() gives it.
function subscription(endpoint: string) {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
      auth: Buffer.alloc(16, 3).toString('base64url'),
    },
  }
}

async function subscriptionCount(): Promise<number> {
  const { rows } = await db().query('SELECT count(*)::int AS count FROM push_subscriptions')
  return rows[0].count
}

test('VAPID keys: a fresh pair is valid, a mismatched or malformed one is refused', () => {
  assert.equal(vapidProblem(keys.publicKey, keys.privateKey), undefined)
  const other = generateVapidKeys()
  assert.match(vapidProblem(keys.publicKey, other.privateKey) ?? '', /not the public key/)
  assert.match(vapidProblem('abc', keys.privateKey) ?? '', /65 bytes/)
  assert.match(vapidProblem('not base64!', keys.privateKey) ?? '', /base64url/)

  const production = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), TRUST_PROXY: '1' }
  const half = configProblems({ ...production, VAPID_PUBLIC_KEY: keys.publicKey })
  assert.ok(half.errors.some((error) => error.includes('VAPID')))
  const whole = configProblems({
    ...production,
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
  })
  assert.ok(!whole.errors.some((error) => error.includes('VAPID')))
  assert.ok(configProblems(production).warnings.some((w) => w.includes('VAPID_PUBLIC_KEY')))
  assert.ok(
    configProblems({ ...production, VAPID_SUBJECT: 'someone' }).errors.some((error) =>
      error.includes('VAPID_SUBJECT'),
    ),
  )

  assert.equal(vapidKeys({}), null)
  assert.equal(
    vapidKeys({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      CONTACT_EMAIL: 'owner@example.com',
    })?.subject,
    'mailto:owner@example.com',
  )
})

test('pushes only go to the push services of browser makers', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) {
    assert.ok(isPushEndpoint(endpoint), endpoint)
  }
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/x',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user@fcm.googleapis.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'not a url',
  ]) {
    assert.ok(!isPushEndpoint(endpoint), endpoint)
  }
})

test('subscribing: logged in only, a known push service, saved for this login', async (t) => {
  withVapid(t)
  const service = await fakePushService(t)
  const body = subscription(`${service.origin}/device/1`)
  assert.equal((await sendJson('/api/push/subscriptions', body)).statusCode, 401)

  const lars = await createSession('Lars')
  const refused = await sendJson(
    '/api/push/subscriptions',
    subscription('https://example.com/not-a-push-service'),
    { cookie: lars },
  )
  assert.equal(refused.statusCode, 400)
  assert.match(refused.body, /Not a push service/)
  const badKey = await sendJson(
    '/api/push/subscriptions',
    { ...body, keys: { p256dh: 'short', auth: body.keys.auth } },
    { cookie: lars },
  )
  assert.equal(badKey.statusCode, 400)

  const saved = await sendJson('/api/push/subscriptions', body, { cookie: lars })
  assert.equal(saved.statusCode, 201)
  assert.deepEqual(JSON.parse(saved.body), { subscribed: true })
  // Again (the same browser asking twice) is still one.
  await sendJson('/api/push/subscriptions', body, { cookie: lars })
  assert.equal(await subscriptionCount(), 1)

  // The edit page knows this device's endpoint, for the button.
  const edit = await request('GET', '/Lars/edit', '', { cookie: lars })
  assert.match(edit.body, /data-enhance="push"/)
  assert.match(edit.body, new RegExp(`data-vapid-key="${keys.publicKey}"`))
  assert.ok(edit.body.includes(`/device/1`))
  assert.match(edit.body, /Push notifications are on for 1 device\./)
  const editJson = JSON.parse(
    (await request('GET', '/Lars/edit', '', { cookie: lars, ...json })).body,
  )
  assert.deepEqual(editJson.push, {
    publicKey: keys.publicKey,
    thisDevice: [body.endpoint],
    devices: 1,
  })

  // Another user's request can't remove it.
  const ada = await createSession('Ada')
  await sendJson('/api/push/subscriptions/delete', { endpoint: body.endpoint }, { cookie: ada })
  assert.equal(await subscriptionCount(), 1)
  const removed = await sendJson(
    '/api/push/subscriptions/delete',
    { endpoint: body.endpoint },
    { cookie: lars },
  )
  assert.deepEqual(JSON.parse(removed.body), { subscribed: false })
  assert.equal(await subscriptionCount(), 0)
})

test('without VAPID keys there is no button, and nothing is pushed', async (t) => {
  const service = await fakePushService(t)
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  const edit = await request('GET', '/Lars/edit', '', { cookie: lars })
  assert.doesNotMatch(edit.body, /data-enhance="push"/)
  await sendJson('/api/push/subscriptions', subscription(`${service.origin}/d`), { cookie: lars })
  await request('POST', '/api/blurts', 'text=hi', { cookie: lars })
  await request('POST', '/api/blurts', `text=re&parentId=${await blurtIdByText('hi')}`, {
    cookie: ada,
  })
  await pushesSettled()
  assert.equal(service.received.length, 0)
})

test('a notification pushes an empty, VAPID-signed message; a burst is one push, then one more', async (t) => {
  withVapid(t)
  const service = await fakePushService(t)
  setPushIntervalSeconds(1)
  t.after(() => setPushIntervalSeconds(60))
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await sendJson('/api/push/subscriptions', subscription(`${service.origin}/device/lars`), {
    cookie: lars,
  })
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  const id = await blurtIdByText('first')

  await request('POST', '/api/blurts', `text=reply 1&parentId=${id}`, { cookie: ada })
  await pushesSettled()
  assert.equal(service.received.length, 1)
  const [push] = service.received
  assert.equal(push.path, '/device/lars')
  assert.equal(push.body, '')
  assert.equal(push.headers['content-length'], '0')
  assert.equal(push.headers.ttl, '86400')
  assert.equal(push.headers.topic, 'notifications')
  assert.equal(push.headers.urgency, 'normal')
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(push.headers.authorization ?? '')
  assert.ok(match, String(push.headers.authorization))
  assert.equal(match[2], keys.publicKey)
  const point = Buffer.from(keys.publicKey, 'base64url')
  const publicKey = await importJWK(
    {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    'ES256',
  )
  const { payload, protectedHeader } = await jwtVerify(match[1], publicKey, {
    audience: service.origin,
  })
  assert.equal(protectedHeader.alg, 'ES256')
  assert.equal(payload.sub, 'mailto:push@example.com')
  assert.ok((payload.exp ?? 0) * 1000 <= Date.now() + 24 * 60 * 60 * 1000)

  // More within the interval: no push now, one when it is up.
  await request('POST', '/api/blurts', `text=reply 2&parentId=${id}`, { cookie: ada })
  await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
  await pushesSettled()
  assert.equal(service.received.length, 1)
  const until = Date.now() + 3000
  while (service.received.length < 2 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await pushesSettled()
  assert.equal(service.received.length, 2)
  // Nothing more is waiting, so nothing more comes.
  await new Promise((resolve) => setTimeout(resolve, pushIntervalSeconds * 1000 + 300))
  await pushesSettled()
  assert.equal(
    service.received.length,
    2,
    JSON.stringify(service.received.map((r) => [r.path, r.at])),
  )

  // A like is no notification; a reply after the interval pushes at once.
  await request('POST', '/api/blurts', `text=reply 3&parentId=${id}`, { cookie: ada })
  await pushesSettled()
  assert.equal(service.received.length, 3)
})

test('the push that follows a burst is dropped when everything was read meanwhile', async (t) => {
  withVapid(t)
  const service = await fakePushService(t)
  setPushIntervalSeconds(1)
  t.after(() => setPushIntervalSeconds(60))
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await sendJson('/api/push/subscriptions', subscription(`${service.origin}/d`), { cookie: lars })
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  const id = await blurtIdByText('first')
  await request('POST', '/api/blurts', `text=reply 1&parentId=${id}`, { cookie: ada })
  await pushesSettled()
  await request('POST', '/api/blurts', `text=reply 2&parentId=${id}`, { cookie: ada })
  await request('POST', '/api/notifications/read', '', { cookie: lars })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await pushesSettled()
  assert.equal(service.received.length, 1)
})

test('a subscription the push service says is gone (404, 410) is deleted', async (t) => {
  withVapid(t)
  const service = await fakePushService(t)
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await sendJson('/api/push/subscriptions', subscription(`${service.origin}/gone`), {
    cookie: lars,
  })
  service.answer(410)
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  await request('POST', '/api/reblurt', `blurtId=${await blurtIdByText('first')}`, { cookie: ada })
  await pushesSettled()
  assert.equal(service.received.length, 1)
  assert.equal(await subscriptionCount(), 0)
})

test('logging out stops the pushes to that device; deleting the account deletes them', async (t) => {
  withVapid(t)
  const service = await fakePushService(t)
  const signup = await request('POST', '/signup', 'username=Lars&password=correct-horse')
  const cookies = (signup.setCookie ?? []).map((cookie) => cookie.split(';', 1)[0]).join('; ')
  const ada = await createSession('Ada')
  await sendJson('/api/push/subscriptions', subscription(`${service.origin}/d`), {
    cookie: cookies,
  })
  await request('POST', '/api/blurts', 'text=mine', { cookie: cookies })
  await request('POST', '/api/logout', '', { cookie: cookies })
  await request('POST', '/api/reblurt', `blurtId=${await blurtIdByText('mine')}`, { cookie: ada })
  await pushesSettled()
  assert.equal(service.received.length, 0, 'the logged-out session gets nothing')

  const login = await request('POST', '/login', 'username=Lars&password=correct-horse')
  const again = (login.setCookie ?? []).map((cookie) => cookie.split(';', 1)[0]).join('; ')
  await sendJson('/api/push/subscriptions', subscription(`${service.origin}/d2`), {
    cookie: again,
  })
  assert.equal(await subscriptionCount(), 2)
  const deleted = await request('POST', '/settings/delete', 'password=correct-horse', {
    cookie: again,
  })
  assert.equal(deleted.statusCode, 303)
  assert.equal(await subscriptionCount(), 0)
})

test('without JavaScript, the edit page can stop pushes on every device', async (t) => {
  withVapid(t)
  const service = await fakePushService(t)
  const lars = await createSession('Lars')
  const before = await request('GET', '/Lars/edit', '', { cookie: lars })
  assert.doesNotMatch(before.body, /Stop push notifications on all devices/)
  await sendJson('/api/push/subscriptions', subscription(`${service.origin}/a`), { cookie: lars })
  const page = await request('GET', '/Lars/edit', '', { cookie: lars })
  assert.match(page.body, /action="\/api\/push\/subscriptions\/delete"/)
  assert.match(page.body, /Stop push notifications on all devices/)
  const stopped = await request('POST', '/api/push/subscriptions/delete', '', { cookie: lars })
  assert.equal(stopped.statusCode, 303)
  assert.equal(stopped.location, '/Lars/edit#notifications')
  assert.equal(await subscriptionCount(), 0)
})

test('/notifications/ redirects to the viewer’s own, or to the login', async () => {
  const anonymous = await request('GET', '/notifications/')
  assert.equal(anonymous.statusCode, 303)
  assert.equal(anonymous.location, '/login')
  const lars = await createSession('Lars')
  const own = await request('GET', '/notifications/?read=1', '', { cookie: lars, ...json })
  assert.equal(own.statusCode, 303)
  assert.equal(own.location, '/Lars/notifications/?read=1')
})

test('the service worker is served from the root, caches nothing, and matches the shared verbs', async () => {
  const response = await request('GET', '/sw.js')
  assert.equal(response.statusCode, 200)
  assert.equal(response.contentType, 'text/javascript; charset=utf-8')
  assert.equal(response.headers['cache-control'], 'no-cache')
  assert.equal(response.headers['content-security-policy'], serviceWorkerContentSecurityPolicy)
  assert.equal(response.headers['set-cookie'], undefined)
  const code = response.body
  assert.doesNotMatch(code, /^\s*import\b/m, 'a classic script')
  assert.doesNotMatch(code, /addEventListener\('fetch'/, 'no fetch handler: nothing cached')
  assert.match(code, /skipWaiting\(\)/)
  assert.match(code, /clients\.claim\(\)/)
  assert.match(code, /addEventListener\('push'/)
  assert.doesNotMatch(code, /:\s*(string|number|Unread)\b[,)=]/, 'types stripped')
  // The worker's copy of the verbs is the shared one.
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'sw.ts'), 'utf8')
  for (const [kind, verb] of Object.entries(notificationVerbs)) {
    assert.ok(source.includes(`${kind}: '${verb}'`), kind)
  }
})

test('the web app manifest and its icons, for Add to Home Screen', async () => {
  const page = await request('GET', '/')
  assert.match(page.body, /<link rel="manifest" href="\/manifest.webmanifest"\/>/)
  assert.match(
    page.body,
    /<link rel="apple-touch-icon" href="\/static\/icons\/apple-touch-icon.png"\/>/,
  )
  assert.match(page.headers['content-security-policy'] as string, /manifest-src 'self'/)

  const response = await request('GET', '/manifest.webmanifest')
  assert.equal(response.statusCode, 200)
  assert.match(response.contentType ?? '', /^application\/manifest\+json/)
  const manifest = JSON.parse(response.body)
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  for (const icon of manifest.icons) {
    const file = await request('GET', icon.src)
    assert.equal(file.statusCode, 200, icon.src)
  }
  for (const path of ['/static/icons/apple-touch-icon.png', '/static/icons/badge-96.png']) {
    assert.equal((await request('GET', path)).statusCode, 200, path)
  }
})
