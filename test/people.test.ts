import test from 'node:test'
import assert from 'node:assert/strict'
import { insertBlurt, createSession, json, request } from './helpers.ts'

test('lists people alphabetically, paged, as HTML, JSON and Markdown', async () => {
  for (const name of ['Zed', 'bob', 'Amy', 'carl']) {
    await createSession(name)
  }
  await insertBlurt('bob', 'one', new Date('2026-01-01'))
  await insertBlurt('bob', 'two', new Date('2026-01-02'))

  const all = JSON.parse((await request('GET', '/people', '', json)).body)
  const names = all.people.map((person: { username: string }) => person.username)
  assert.deepEqual(names.slice(0, 4), ['Amy', 'bob', 'carl', 'Zed'])
  assert.equal(all.next, null)
  const bob = all.people[1]
  assert.equal(bob.blurtCount, 2)
  assert.equal(bob.followerCount, 0)
  assert.equal(bob.lastBlurtAt, '2026-01-02T00:00:00.000Z')
  assert.equal(all.people[0].lastBlurtAt, null)
  assert.ok(bob.avatar && bob.joinedAt)

  // The cursor is the last username in lower case.
  const after = JSON.parse((await request('GET', '/people?after=bob', '', json)).body)
  assert.deepEqual(
    after.people.map((person: { username: string }) => person.username).slice(0, 2),
    ['carl', 'Zed'],
  )
  assert.equal((await request('GET', '/people?after=B%20ob', '', json)).statusCode, 400)

  // /people is a page, so nobody can sign up as it.
  for (const name of ['people', 'People', 'accounts']) {
    const signup = await request('POST', '/signup', `username=${name}&password=correct-horse`, json)
    assert.equal(signup.statusCode, 400, name)
  }

  const html = await request('GET', '/people')
  assert.equal(html.statusCode, 200)
  assert.match(html.body, /<a href="\/Amy\/">Amy<\/a>[^]*<a href="\/bob\/">bob<\/a>/)
  assert.match(html.body, /2 blurts/)

  const markdown = await request('GET', '/people', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /^# People/m)
  assert.match(markdown.body, /- \[bob\]\(<\/bob\/>\): 2 blurts, 0 followers/)
})
