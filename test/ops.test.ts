import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { closeDb, dbRead } from '../src/db.ts'
import { configProblems } from '../src/config.ts'
import {
  countServerError,
  log,
  resetServerErrorCount,
  sendAlert,
  serverErrorWindowMs,
} from '../src/logging.ts'
import { collectLogs, createSession, json, request, testMigrationDatabaseUrl } from './helpers.ts'

test('development needs no configuration', () => {
  assert.deepEqual(configProblems({}), { errors: [], warnings: [] })
})

test('production refuses to start with a missing or malformed configuration', () => {
  const good = {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgres://blurt:secret@127.0.0.1:6432/blurt',
    MIGRATION_DATABASE_URL: 'postgres://blurt:secret@127.0.0.1:5432/blurt',
    TRUST_PROXY: '1',
    ALERT_WEBHOOK_URL: 'https://hooks.example.com/T000/secret',
    CONTACT_REPO_URL: 'https://github.com/example/blurt.trade',
  }
  assert.deepEqual(configProblems(good), { errors: [], warnings: [] })

  const errorsWith = (changes: Record<string, string | undefined>) =>
    configProblems({ ...good, ...changes }).errors
  assert.match(errorsWith({ JWT_SECRET: 'short' }).join(), /JWT_SECRET/)
  assert.match(errorsWith({ DATABASE_URL: undefined }).join(), /DATABASE_URL/)
  assert.match(errorsWith({ DATABASE_URL: 'mysql://x' }).join(), /DATABASE_URL/)
  assert.match(errorsWith({ TRUST_PROXY: undefined }).join(), /TRUST_PROXY/)
  assert.deepEqual(errorsWith({ TRUST_PROXY: 'false' }), [])
  assert.match(errorsWith({ PORT: '80a' }).join(), /PORT/)
  assert.match(errorsWith({ DB_POOL_SIZE: '0' }).join(), /DB_POOL_SIZE/)
  assert.match(errorsWith({ READ_YOUR_WRITES_SECONDS: '2.5' }).join(), /READ_YOUR_WRITES/)
  assert.match(errorsWith({ MIGRATE_ON_START: 'no' }).join(), /MIGRATE_ON_START/)
  assert.match(errorsWith({ ALERT_WEBHOOK_URL: 'hooks.example.com' }).join(), /ALERT_WEBHOOK/)
  assert.match(errorsWith({ ALERT_5XX_THRESHOLD: '0' }).join(), /ALERT_5XX_THRESHOLD/)
  assert.match(errorsWith({ CONTACT_EMAIL: 'nobody' }).join(), /CONTACT_EMAIL/)
  assert.match(errorsWith({ CONTACT_REPO_URL: 'https://gitlab.com/a/b' }).join(), /CONTACT_REPO/)
  // Several problems are reported together.
  assert.equal(errorsWith({ JWT_SECRET: '', DATABASE_URL: undefined }).length, 2)

  const warningsWith = (changes: Record<string, string | undefined>) =>
    configProblems({ ...good, ...changes }).warnings
  assert.match(warningsWith({ MIGRATION_DATABASE_URL: undefined }).join(), /MIGRATION/)
  assert.deepEqual(
    warningsWith({ MIGRATION_DATABASE_URL: undefined, MIGRATE_ON_START: 'false' }),
    [],
  )
  assert.match(warningsWith({ RATE_LIMIT_SCALE: '0' }).join(), /RATE_LIMIT_SCALE/)
  assert.match(warningsWith({ ALERT_WEBHOOK_URL: undefined }).join(), /ALERT_WEBHOOK_URL/)
  assert.match(warningsWith({ CONTACT_REPO_URL: undefined }).join(), /CONTACT_EMAIL nor/)
  assert.deepEqual(
    warningsWith({ CONTACT_REPO_URL: undefined, CONTACT_EMAIL: 'owner@example.com' }),
    [],
  )
})

test('the server shuts down cleanly on SIGTERM', async () => {
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'server.ts')], {
    env: {
      ...process.env,
      PORT: '0',
      MIGRATION_DATABASE_URL: testMigrationDatabaseUrl,
      DATABASE_READ_URL: '',
    },
  })
  let output = ''
  child.stderr.on('data', (chunk) => (output += chunk))
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk
      const match = /"msg":"listening","port":(\d+)/.exec(output)
      if (match) {
        resolve(Number(match[1]))
      }
    })
    child.on('exit', () => reject(new Error(`Server exited before listening:\n${output}`)))
  })

  const response = await fetch(`http://localhost:${port}/createUser`)
  assert.equal(response.status, 200)
  child.kill('SIGTERM')
  assert.equal(await exited, 0, output)
  assert.match(output, /"msg":"shut down cleanly"/)
})

test('logs one line per request, without the query string', async (t) => {
  const logs = collectLogs(t)
  const response = await request('GET', '/everyone?before=nonsense', '', json)
  assert.equal(response.statusCode, 400)
  const id = response.headers['x-request-id']
  assert.match(String(id), /^[0-9a-f-]{36}$/)
  const line = logs.find((entry) => entry.msg === 'request')
  assert.ok(line)
  assert.deepEqual(Object.keys(line).sort(), [
    'id',
    'level',
    'method',
    'ms',
    'msg',
    'path',
    'status',
    'time',
  ])
  assert.equal(line.id, id)
  assert.equal(line.method, 'GET')
  assert.equal(line.path, '/everyone')
  assert.equal(line.status, 400)
  assert.equal(typeof line.ms, 'number')
})

test('never logs passwords, tokens or cookies', async (t) => {
  const logs = collectLogs(t)
  const password = 'very-secret-password-42'
  const created = await request('POST', '/createUser', `username=Lars&password=${password}`)
  assert.equal(created.statusCode, 303)
  const cookie = created.setCookie?.[0]?.split(';', 1)[0] ?? ''
  const wrong = await request('POST', '/login', `username=Lars&password=${password}-wrong`)
  assert.equal(wrong.statusCode, 400)
  const right = await request('POST', '/login', `username=Lars&password=${password}`, { cookie })
  assert.equal(right.statusCode, 303)
  const token = right.setCookie?.[0]?.split(';', 1)[0]?.split('=')[1] ?? ''
  assert.ok(token.length > 20)

  const output = logs.map((entry) => JSON.stringify(entry)).join('\n')
  assert.equal(logs.filter((entry) => entry.path === '/login').length, 2)
  assert.doesNotMatch(output, /very-secret-password/)
  assert.doesNotMatch(output, /password/i)
  assert.ok(!output.includes(token), 'session token in the logs')
  assert.ok(!output.includes(cookie.split('=')[1]), 'cookie in the logs')
})

// Makes every read from the (pretend) replica fail.
function breakReadPool(t: { after: (callback: () => Promise<void>) => void }, message: string) {
  process.env.DATABASE_READ_URL = process.env.DATABASE_URL
  t.after(async () => {
    delete process.env.DATABASE_READ_URL
    await closeDb()
  })
  dbRead().query = (async () => {
    throw new Error(message)
  }) as unknown as ReturnType<typeof dbRead>['query']
}

test('an unexpected error is logged with its request id and answered with a generic 500', async (t) => {
  await createSession('Lars')
  resetServerErrorCount()
  breakReadPool(t, 'forced failure in a query')
  const logs = collectLogs(t)

  const page = await request('GET', '/everyone')
  assert.equal(page.statusCode, 500)
  assert.match(page.contentType ?? '', /^text\/html/)
  const id = String(page.headers['x-request-id'])
  assert.match(page.body, /Something went wrong/)
  assert.match(page.body, /<h1>Something went wrong<\/h1>/)
  assert.ok(page.body.includes(id), 'the request id is shown')
  assert.doesNotMatch(page.body, /forced failure|at |\.ts/)

  const error = logs.find((entry) => entry.msg === 'unhandled error')
  assert.ok(error)
  assert.equal(error.id, id)
  assert.equal(error.level, 'error')
  const details = error.error as { message: string; stack: string }
  assert.equal(details.message, 'forced failure in a query')
  assert.match(details.stack, /at /)
  const line = logs.find((entry) => entry.msg === 'request')
  assert.deepEqual([line?.id, line?.status, line?.level], [id, 500, 'error'])

  const api = await request('GET', '/everyone', '', json)
  assert.equal(api.statusCode, 500)
  const body = JSON.parse(api.body)
  assert.equal(body.requestId, api.headers['x-request-id'])
  assert.doesNotMatch(body.error, /forced failure/)

  const plain = await request('GET', '/everyone', '', { accept: 'text/plain' })
  assert.equal(plain.statusCode, 500)
  assert.match(plain.contentType ?? '', /^text\/plain/)
  assert.match(plain.body, /Something went wrong/)
  resetServerErrorCount()
})

test('/healthz checks the database', async (t) => {
  const healthy = await request('GET', '/healthz')
  assert.equal(healthy.statusCode, 200)
  assert.equal(healthy.body, 'ok\n')
  assert.equal(healthy.headers['cache-control'], 'no-store')

  breakReadPool(t, 'connection refused')
  const logs = collectLogs(t)
  const down = await request('GET', '/healthz')
  assert.equal(down.statusCode, 503)
  assert.equal(down.body, 'read replica unavailable\n')
  assert.ok(logs.some((entry) => entry.msg === 'health check failed'))
  // Successful checks are not logged; failed ones are.
  assert.deepEqual(
    logs.filter((entry) => entry.msg === 'request').map((entry) => entry.status),
    [503],
  )
})

test('alerts once per window when 5xx responses spike', (t) => {
  const logs = collectLogs(t)
  resetServerErrorCount()
  t.after(resetServerErrorCount)
  const start = 1_000_000
  const alerts = Array.from({ length: 12 }, (_, i) => countServerError(start + i, 10))
  assert.deepEqual(
    alerts.flatMap((alerted, i) => (alerted ? [i] : [])),
    [9],
  )
  assert.equal(logs.filter((entry) => entry.msg === '5xx spike').length, 1)
  // A new window starts counting again.
  assert.equal(countServerError(start + serverErrorWindowMs, 2), false)
  assert.equal(countServerError(start + serverErrorWindowMs + 1, 2), true)
})

test('sends alerts to ALERT_WEBHOOK_URL, and does nothing without it', async (t) => {
  const received: string[] = []
  const server = http.createServer((incoming, response) => {
    let body = ''
    incoming.on('data', (chunk: Buffer) => (body += chunk.toString()))
    incoming.on('end', () => {
      received.push(body)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  t.after(() => server.close())
  const address = server.address() as { port: number }

  await sendAlert('nothing configured', {})
  await sendAlert('the site is on fire', {
    ALERT_WEBHOOK_URL: `http://localhost:${address.port}/hook`,
  })
  assert.deepEqual(
    received.map((body) => JSON.parse(body)),
    [{ text: 'blurt.trade: the site is on fire' }],
  )

  // A failing webhook is logged, without its URL.
  const logs = collectLogs(t)
  await sendAlert('unreachable', { ALERT_WEBHOOK_URL: 'http://localhost:1/secret-token' })
  assert.equal(logs.length, 1)
  assert.equal(logs[0].msg, 'alert failed')
  assert.doesNotMatch(JSON.stringify(logs), /secret-token/)
})

test('log lines are single-line JSON, with errors expanded', (t) => {
  const logs = collectLogs(t)
  log('error', 'something', { error: new Error('two\nlines') })
  assert.equal(logs.length, 1)
  assert.equal((logs[0].error as { message: string }).message, 'two\nlines')
})
