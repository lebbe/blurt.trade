import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { app, blurts } from './server.ts'
import { users } from './routes/state.ts'

function request(
  method: string,
  path: string,
  body = '',
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; location?: string; setCookie?: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine test server address'))
        return
      }

      const request = http.request(
        {
          method,
          port: address.port,
          path,
          headers: {
            ...(body
              ? {
                  'content-type': 'application/x-www-form-urlencoded',
                  'content-length': Buffer.byteLength(body),
                }
              : {}),
            ...headers,
          },
        },
        (response: {
          statusCode?: number
          headers: { location?: string; 'set-cookie'?: string[] }
          on: (event: string, callback: (chunk?: Buffer) => void) => void
        }) => {
          let responseBody = ''
          response.on('data', (chunk) => {
            responseBody += chunk?.toString() ?? ''
          })
          response.on('end', () => {
            server.close()
            resolve({
              statusCode: response.statusCode ?? 0,
              location: response.headers.location,
              setCookie: response.headers['set-cookie'],
              body: responseBody,
            })
          })
        },
      )
      request.on('error', reject)
      request.end(body)
    })
  })
}

test.beforeEach(() => {
  blurts.length = 0
  users.length = 0
})

async function createSession(): Promise<string> {
  const response = await request('POST', '/createUser', 'username=Lars&password=correct-horse')
  assert.equal(response.statusCode, 303)
  return response.setCookie?.[0]?.split(';', 1)[0] ?? ''
}

test('shows the empty feed', async () => {
  const response = await request('GET', '/')

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /Nothing has been blurted yet/)
  assert.doesNotMatch(response.body, /action="\/blurts"/)
  assert.match(response.body, /href="\/login"/)
  assert.match(response.body, /href="\/createUser"/)
})

test('serves the feed as JSON when requested', async () => {
  const createdAt = new Date('2026-10-10T12:00:00.000Z')
  blurts.push({ id: 1, username: 'Lars', text: 'Hello world', createdAt })

  const response = await request('GET', '/', '', { accept: 'application/json' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), [
    { id: 1, username: 'Lars', text: 'Hello world', createdAt: createdAt.toISOString() },
  ])
})

test('serves the feed as Markdown when plain text is requested', async () => {
  const createdAt = new Date('2026-10-10T12:00:00.000Z')
  blurts.push({ id: 1, username: 'Lars', text: 'Hello *world*', createdAt })

  const response = await request('GET', '/', '', { accept: 'text/plain' })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /# blurt\.trade/)
  assert.match(response.body, /### Lars/)
  assert.ok(response.body.includes('Hello \\*world\\*'))
})

test('rejects unsupported feed representations', async () => {
  const response = await request('GET', '/', '', { accept: 'application/xml' })

  assert.equal(response.statusCode, 406)
})

test('rejects blurt submissions without authentication', async () => {
  const response = await request('POST', '/blurts', 'text=Hello+world')

  assert.equal(response.statusCode, 401)
  assert.equal(blurts.length, 0)
})

test('creates a blurt and redirects back to the feed', async () => {
  const cookie = await createSession()
  const response = await request('POST', '/blurts', 'text=Hello+world', { cookie })

  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/')
  assert.equal(blurts[0].username, 'Lars')
  assert.equal(blurts[0].text, 'Hello world')
})

test('renders submitted input and validation errors for an invalid blurt', async () => {
  const cookie = await createSession()
  const response = await request('POST', '/blurts', 'text=', { cookie })

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Blurt is required/)
  assert.equal(blurts.length, 0)
})

test('creates a user, logs them in, and redirects to the feed', async () => {
  const form = await request('GET', '/createUser')
  assert.equal(form.statusCode, 200)
  assert.match(form.body, /action="\/createUser"/)

  const response = await request('POST', '/createUser', 'username=Lars&password=correct-horse')

  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/')
  assert.equal(users[0].username, 'Lars')
  assert.notEqual(users[0].passwordHash, 'correct-horse')
  assert.match(response.setCookie?.[0] ?? '', /^access_token=.*HttpOnly/i)

  const authenticatedFeed = await request('GET', '/', '', {
    cookie: response.setCookie?.[0]?.split(';', 1)[0] ?? '',
  })
  assert.match(authenticatedFeed.body, /action="\/blurts"/)
  assert.doesNotMatch(authenticatedFeed.body, /name="name"/)
  assert.match(authenticatedFeed.body, /action="\/logout"/)

  const logout = await request('GET', '/logout', '', {
    cookie: response.setCookie?.[0]?.split(';', 1)[0] ?? '',
  })
  assert.equal(logout.statusCode, 303)
  assert.equal(logout.location, '/')
  assert.match(logout.setCookie?.[0] ?? '', /access_token=;/)
  assert.match(logout.setCookie?.[0] ?? '', /Max-Age=0/i)
})
