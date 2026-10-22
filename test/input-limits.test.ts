import test from 'node:test'
import assert from 'node:assert/strict'
import { getUserProfileByUsername } from '../src/routes/state.ts'
import { bodyLimit } from '../src/limits.ts'
import {
  blurtIdByText,
  countBlurts,
  createSession,
  insertBlurt,
  json,
  request,
  sendJson,
} from './helpers.ts'

test('rejects over-long blurts, counting characters, not bytes or UTF-16 units', async () => {
  const cookie = await createSession('Lars')
  const post = (text: unknown) => sendJson('/api/blurts', { text }, { cookie })

  const emoji = await post('😀'.repeat(280)) // 560 UTF-16 units, 1120 bytes
  assert.equal(emoji.statusCode, 201)
  const padded = await post(`  ${'x'.repeat(280)}\n `) // whitespace is trimmed first
  assert.equal(padded.statusCode, 201)
  assert.equal(JSON.parse(padded.body).text, 'x'.repeat(280))

  for (const text of ['😀'.repeat(281), 'x'.repeat(281), '   ', ['a', 'b']]) {
    const response = await post(text)
    assert.equal(response.statusCode, 400)
    assert.equal(JSON.parse(response.body).errors[0].field, 'text')
  }

  const form = await request('POST', '/api/blurts', `text=${'x'.repeat(281)}`, { cookie })
  assert.equal(form.statusCode, 400)
  assert.match(form.body, /Blurt must be at most 280 characters/)
  assert.match(form.body, /<textarea name="text" maxlength="280"/)
  assert.equal(await countBlurts(), 2)
})

test('rejects over-long and non-http(s) profile fields with the field named', async () => {
  const cookie = await createSession('Lars')
  const edit = (fields: Record<string, unknown>) => sendJson('/Lars/edit', fields, { cookie })
  const cases: [Record<string, unknown>, string][] = [
    [{ bio: 'x'.repeat(4001) }, 'bio'],
    [{ homepage: `https://example.com/${'x'.repeat(200)}` }, 'homepage'],
    [{ homepage: 'javascript:alert(1)' }, 'homepage'],
    [{ homepage: 'data:text/html,hi' }, 'homepage'],
    [{ homepage: 'http:example.com' }, 'homepage'],
    [{ x: 'x'.repeat(201) }, 'x'],
    [{ github: 'javascript:alert(1)' }, 'github'],
    [{ linkedin: 'ftp://example.com/lars' }, 'linkedin'],
    [{ youtube: { nested: true } }, 'youtube'],
  ]
  for (const [fields, field] of cases) {
    const response = await edit(fields)
    assert.equal(response.statusCode, 400, field)
    assert.equal(JSON.parse(response.body).errors[0].field, field)
  }

  const full = await edit({ bio: '😀'.repeat(4000), homepage: ' HTTPS://example.com ' })
  assert.equal(full.statusCode, 200)
  const profile = await getUserProfileByUsername('Lars')
  assert.equal(profile?.bio, '😀'.repeat(4000))
  assert.equal(profile?.homepage, 'HTTPS://example.com')
})

test('rejects over-long usernames, passwords and query parameters', async () => {
  const signUp = (username: string, password: string) => sendJson('/signup', { username, password })
  const longName = await signUp('x'.repeat(41), 'long enough')
  assert.equal(JSON.parse(longName.body).errors[0].field, 'username')
  const longPassword = await signUp('Lars', 'x'.repeat(201))
  assert.equal(longPassword.statusCode, 400)
  assert.equal(JSON.parse(longPassword.body).errors[0].field, 'password')
  const login = await sendJson('/login', { username: 'Lars', password: 'x'.repeat(201) })
  assert.equal(JSON.parse(login.body).errors[0].field, 'password')

  const cookie = await createSession('Lars')
  await insertBlurt('Lars', 'Hello world', new Date('2026-10-10T12:00:00.000Z'))
  const id = await blurtIdByText('Hello world')
  const longCursor = Buffer.from(`2026-10-10T12:00:00.000000Z_1${' '.repeat(100)}`)
  for (const [path, field] of [
    [`/waitlist?username=${'x'.repeat(41)}`, 'username'],
    [`/signup?invite=${'x'.repeat(41)}`, 'invite'],
    [`/?before=${longCursor.toString('base64url')}`, 'before'],
    [`/Lars/?before=${'A'.repeat(5000)}`, 'before'],
    [`/Lars/${id}?after=nonsense`, 'after'],
    ['/near?radius=999999', 'radius'],
    ['/near?radius=-1', 'radius'],
  ]) {
    const response = await request('GET', path, '', { ...json, cookie })
    assert.equal(response.statusCode, 400, path.slice(0, 40))
    assert.equal(JSON.parse(response.body).field, field, path.slice(0, 40))
  }
})

test('answers an oversized body with a 413 in the usual error format', async () => {
  const cookie = await createSession('Lars')
  const message = `Request body is too large (at most ${bodyLimit})`
  const big = 'x'.repeat(65 * 1024)

  const form = await request('POST', '/api/blurts', `text=${big}`, { cookie })
  assert.equal(form.statusCode, 413)
  assert.match(form.contentType ?? '', /^text\/plain/)
  assert.equal(form.body, message)

  const asJson = await sendJson('/Lars/edit', { bio: big }, { cookie })
  assert.equal(asJson.statusCode, 413)
  assert.deepEqual(JSON.parse(asJson.body), { error: message })
  assert.equal(await countBlurts(), 0)

  // The largest real body, a full bio of 4-byte characters percent-encoded, still fits.
  const bio = encodeURIComponent('😀'.repeat(4000))
  const fullBio = await request('POST', '/Lars/edit', `bio=${bio}`, { cookie })
  assert.equal(fullBio.statusCode, 303)
})
