import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clientKey,
  parseLimit,
  setRateLimitScale,
  take,
  trustProxySetting,
} from '../src/middleware/rate-limit.ts'
import { countBlurts, createSession, from, request, withRealRateLimits } from './helpers.ts'

test('hammering login from one IP gets 429s while another IP is unaffected', async () => {
  await createSession('Lars')
  await withRealRateLimits(async () => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 12; attempt++) {
      const username = `guess${attempt}` // a new username each time: only the IP limit applies
      const response = await request(
        'POST',
        '/login',
        `username=${username}&password=wrong-horse`,
        from('203.0.113.7'),
      )
      statuses.push(response.statusCode)
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400))
    assert.deepEqual(statuses.slice(10), [429, 429])

    const limited = await request(
      'POST',
      '/login',
      'username=Lars&password=correct-horse',
      from('203.0.113.7', { accept: 'application/json' }),
    )
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.retryAfter) > 0, 'Retry-After is a number of seconds')
    assert.match(JSON.parse(limited.body).error, /Too many requests/)

    const html = await request('POST', '/login', 'username=Lars&password=x', from('203.0.113.7'))
    assert.equal(html.statusCode, 429)
    assert.match(html.contentType ?? '', /text\/plain/)

    const other = await request(
      'POST',
      '/login',
      'username=Lars&password=correct-horse',
      from('198.51.100.1'),
    )
    assert.equal(other.statusCode, 303)
  })
})

test('failed logins for one username are limited across IPs, but the owner is not', async () => {
  await createSession('Lars')
  await withRealRateLimits(async () => {
    // Logging in successfully over and over doesn't use up the username's budget.
    for (let attempt = 0; attempt < 6; attempt++) {
      const ok = await request(
        'POST',
        '/login',
        'username=Lars&password=correct-horse',
        from(`198.51.100.${attempt}`),
      )
      assert.equal(ok.statusCode, 303)
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = await request(
        'POST',
        '/login',
        'username=lars&password=wrong-horse',
        from(`203.0.113.${attempt}`),
      )
      assert.equal(wrong.statusCode, 400)
    }
    const limited = await request(
      'POST',
      '/login',
      'username=LARS&password=wrong-horse',
      from('203.0.113.99'),
    )
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.retryAfter) <= 60, 'a token comes back within a minute')
  })
})

test('sign-up is limited per IP', async () => {
  await withRealRateLimits(async () => {
    for (let index = 0; index < 5; index++) {
      const response = await request(
        'POST',
        '/createUser',
        `username=user${index}&password=correct-horse`,
        from('203.0.113.7'),
      )
      assert.equal(response.statusCode, 303)
    }
    const limited = await request(
      'POST',
      '/createUser',
      'username=user5&password=correct-horse',
      from('203.0.113.7'),
    )
    assert.equal(limited.statusCode, 429)
    const other = await request(
      'POST',
      '/createUser',
      'username=user5&password=correct-horse',
      from('198.51.100.1'),
    )
    assert.equal(other.statusCode, 303)
  })
})

test('blurt posting is limited per account, with a burst', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await withRealRateLimits(async () => {
    for (let index = 0; index < 20; index++) {
      // From a different IP each time: the limit follows the account, not the address.
      const response = await request(
        'POST',
        '/api/blurts',
        `text=Blurt+${index}`,
        from(`203.0.113.${index}`, { cookie: lars }),
      )
      assert.equal(response.statusCode, 303)
    }
    const limited = await request('POST', '/api/blurts', 'text=One+more', {
      cookie: lars,
      accept: 'application/json',
    })
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.retryAfter) > 0)
    assert.equal(await countBlurts(), 20)

    const other = await request('POST', '/api/blurts', 'text=Ada+is+fine', { cookie: ada })
    assert.equal(other.statusCode, 303)
  })
})

test('follow and unfollow share one per-account budget', async () => {
  const lars = await createSession('Lars')
  await createSession('Ada')
  await withRealRateLimits(async () => {
    for (let index = 0; index < 60; index++) {
      const path = index % 2 === 0 ? '/api/follow' : '/api/unfollow'
      const response = await request('POST', path, 'username=Ada', { cookie: lars })
      assert.equal(response.statusCode, 303)
    }
    const limited = await request('POST', '/api/follow', 'username=Ada', { cookie: lars })
    assert.equal(limited.statusCode, 429)
  })
})

test('ordinary use never meets a limit', async () => {
  await withRealRateLimits(async () => {
    const lars = await createSession('Lars')
    await createSession('Ada')
    await createSession('Grace')
    const steps = [
      ['/login', 'username=Lars&password=wrong-horse'],
      ['/login', 'username=Lars&password=correct-horse'],
      ['/Lars/edit', 'bio=hello'],
      ['/api/avatar', 'random=1'],
      ['/api/follow', 'username=Ada'],
      ['/api/follow', 'username=Grace'],
      ['/api/unfollow', 'username=Grace'],
      ...Array.from({ length: 10 }, (_, index) => ['/api/blurts', `text=Blurt+${index}`]),
    ]
    for (const [path, body] of steps) {
      const response = await request('POST', path, body, { cookie: lars })
      assert.notEqual(response.statusCode, 429, `${path} was rate limited`)
    }
  })
})

test('a bucket refills steadily after the burst', () => {
  const start = 1_000_000
  setRateLimitScale(1)
  try {
    for (let index = 0; index < 20; index++) {
      assert.equal(take('blurt', 'refill-test', start).allowed, true)
    }
    const empty = take('blurt', 'refill-test', start)
    assert.equal(empty.allowed, false)
    // 20 per 10 minutes: one token every 30 seconds.
    assert.equal(!empty.allowed && empty.retryAfterSeconds, 30)
    assert.equal(take('blurt', 'refill-test', start + 29_000).allowed, false)
    assert.equal(take('blurt', 'refill-test', start + 30_000).allowed, true)
  } finally {
    setRateLimitScale(1000)
  }
})

test('parses limit specs, trust proxy settings and client keys', () => {
  assert.deepEqual(parseLimit('10/5m'), { burst: 10, periodSeconds: 300 })
  assert.deepEqual(parseLimit('3/1h'), { burst: 3, periodSeconds: 3600 })
  assert.equal(parseLimit('10'), undefined)
  assert.equal(parseLimit('0/1m'), undefined)
  assert.equal(trustProxySetting(undefined), false)
  assert.equal(trustProxySetting('1'), 1)
  assert.equal(trustProxySetting('loopback'), 'loopback')
  const key = (ip: string) => clientKey({ ip, socket: {} } as never)
  assert.equal(key('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(key('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64')
  assert.equal(key('2001:db8::1'), '2001:db8:0:0::/64')
})
