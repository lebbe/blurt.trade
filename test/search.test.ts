import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { blurtSearchWhere, deleteBlurts } from '../src/routes/state.ts'
import {
  blurtIdByText,
  collectLogs,
  createSession,
  from,
  insertBlurt,
  json,
  request,
  search,
  withRealRateLimits,
} from './helpers.ts'

test('searches usernames and blurt text without JS, as HTML, JSON and Markdown', async () => {
  const cookie = await createSession('Olars')
  for (const name of ['Larsen', 'Lars', 'Ada', 'lars_xyz']) {
    await createSession(name)
  }
  await insertBlurt('Ada', 'I love my cat', new Date('2026-01-01'))
  await insertBlurt('Lars', 'The CAT sat on the mat', new Date('2026-01-02'))
  await insertBlurt('Larsen', 'Stocks only go up', new Date('2026-01-03'))

  // Prefix matches first (shortest, so the exact name, first), then substrings.
  const users = await search('?q=LARS')
  assert.equal(users.statusCode, 200)
  const data = JSON.parse(users.body)
  assert.equal(data.query, 'LARS')
  assert.deepEqual(
    data.users.map((user: { username: string }) => user.username),
    ['Lars', 'Larsen', 'lars_xyz', 'Olars'],
  )
  assert.ok(data.users[0].avatar, 'users come with their avatar')
  assert.deepEqual(data.blurts, [])
  // `_` is a plain character, not a LIKE wildcard; a leading @ is ignored.
  const underscore = JSON.parse((await search('?q=%40s_x')).body)
  assert.deepEqual(
    underscore.users.map((user: { username: string }) => user.username),
    ['lars_xyz'],
  )

  // Words, any case, newest first; every word must match.
  const cats = JSON.parse((await search('?q=Cat', { ...json, cookie })).body)
  assert.deepEqual(
    cats.blurts.map((blurt: { text: string }) => blurt.text),
    ['The CAT sat on the mat', 'I love my cat'],
  )
  assert.equal(cats.blurts[0].username, 'Lars')
  assert.equal(cats.next, null)
  const both = JSON.parse((await search('?q=cat%20mat')).body)
  assert.deepEqual(
    both.blurts.map((blurt: { text: string }) => blurt.text),
    ['The CAT sat on the mat'],
  )

  // HTML: the search box is a plain GET form on every page, filled in on the results.
  for (const path of ['/', '/everyone', '/login', '/about', '/Ada/']) {
    const page = await request('GET', path)
    assert.match(page.body, /<form method="get" action="\/search" role="search"/, path)
  }
  const html = await request('GET', '/search?q=cat', '', { cookie })
  assert.equal(html.statusCode, 200)
  assert.match(html.body, /<input id="site-search-q" type="search" name="q" value="cat"/)
  assert.match(html.body, /Results for <q>cat<\/q>/)
  assert.match(html.body, /The CAT sat on the mat[^]*I love my cat/)
  assert.match(html.body, /action="\/api\/like"/)
  const people = await request('GET', '/search?q=ada')
  assert.match(people.body, /<h2>People<\/h2>[^]*<a href="\/Ada\/">[^]*Ada<\/a/)
  assert.match(people.body, /No blurts match\./)

  const markdown = await search('?q=cat', { accept: 'text/markdown' })
  assert.match(markdown.contentType ?? '', /^text\/markdown/)
  assert.match(markdown.body, /^# Search\n[^]*Results for `cat`[^]*## Blurts\n[^]*### Lars\n/)
  const markdownUsers = await search('?q=ada', { accept: 'text/markdown' })
  assert.match(markdownUsers.body, /## People\n\n- \[Ada\]\(<\/Ada\/>\)/)
})

test('an empty or malformed search is a friendly page; one over the limit is a 400', async () => {
  await createSession('Lars')
  await insertBlurt('Lars', 'hello world', new Date())
  for (const query of ['', '?q=', '?q=%20%20', '?q[]=hello', '?q=hello&q=world', '?q=%00']) {
    const response = await search(query)
    assert.equal(response.statusCode, 200, query)
    const data = JSON.parse(response.body)
    assert.equal(data.query, '', query)
    assert.deepEqual([data.users, data.blurts], [[], []], query)
    const html = await request('GET', `/search${query}`)
    assert.match(html.body, /Type a username or some words in the search box above\./, query)
  }
  // Punctuation and search syntax are just words to websearch_to_tsquery: no errors.
  for (const query of ['!!!', '"unclosed', 'a & | ! (', "o'reilly", '-', 'or', ':*']) {
    const response = await search(`?q=${encodeURIComponent(query)}`)
    assert.equal(response.statusCode, 200, query)
  }
  assert.equal((await search('?q=hello%00world')).statusCode, 200)

  const atLimit = await search(`?q=${'a'.repeat(200)}`)
  assert.equal(atLimit.statusCode, 200)
  const tooLong = await search(`?q=${encodeURIComponent('😀'.repeat(201))}`)
  assert.equal(tooLong.statusCode, 400)
  assert.deepEqual(JSON.parse(tooLong.body), {
    error: 'Search is too long (at most 200 characters)',
    field: 'q',
  })
  const badCursor = await search('?q=hello&before=nonsense')
  assert.equal(badCursor.statusCode, 400)
  assert.equal(JSON.parse(badCursor.body).field, 'before')
})

test('search escapes the query when showing it back, and never logs it', async (t) => {
  const logs = collectLogs(t)
  const query = '<script>alert("secretword")</script>'
  const html = await request('GET', `/search?q=${encodeURIComponent(query)}`)
  assert.equal(html.statusCode, 200)
  assert.doesNotMatch(html.body, /<script>/)
  assert.match(
    html.body,
    /Results for <q>&lt;script>alert\(&quot;secretword&quot;\)&lt;\/script><\/q>/,
  )
  assert.match(html.body, /value="&lt;script>alert\(&quot;secretword&quot;\)&lt;\/script>"/)
  const markdown = await search(`?q=${encodeURIComponent('*bold* [x](http://evil)')}`, {
    accept: 'text/markdown',
  })
  assert.match(markdown.body, /Results for `\*bold\* \[x\]\(http:\/\/evil\)`/)
  await search('?q=secretword')
  assert.ok(logs.length > 0)
  assert.doesNotMatch(JSON.stringify(logs), /secretword/)
})

test('search leaves out deleted blurts and pages older matches', async () => {
  const cookie = await createSession('Lars')
  await insertBlurt('Lars', 'a doomed needle', new Date('2020-01-01'))
  const parentId = await blurtIdByText('a doomed needle')
  await request('POST', '/api/blurts', `parentId=${parentId}&text=reply without it`, { cookie })
  await deleteBlurts([parentId]) // stays as a placeholder: it has a reply
  const placeholder = await db().query('SELECT text FROM blurts WHERE id = $1', [parentId])
  assert.equal(placeholder.rows[0].text, null)
  assert.deepEqual(JSON.parse((await search('?q=needle')).body).blurts, [])
  assert.deepEqual(JSON.parse((await search('?q=doomed')).body).blurts, [])

  await db().query(
    `INSERT INTO blurts (user_id, text, created_at)
     SELECT u.id, 'needle ' || i, timestamptz '2021-01-01' + i * interval '1 minute'
     FROM users u, generate_series(1, 101) AS i WHERE u.username = 'Lars'`,
  )
  const none = JSON.parse((await search('?q=needle%20Lars')).body)
  assert.equal(none.blurts.length, 0, 'every word must match the text')
  const page = JSON.parse((await search('?q=needle')).body)
  assert.equal(page.blurts.length, 100)
  assert.equal(page.blurts[0].text, 'needle 101')
  assert.ok(page.next)
  const html = await request('GET', '/search?q=needle')
  assert.match(html.body, /<a href="\/search\?q=needle&amp;before=[^"]+" rel="next">Older blurts/)
  const second = JSON.parse((await search(`?q=lars&before=${page.next}`)).body)
  assert.deepEqual(second.users, [], 'users come only on the first page')
  const older = JSON.parse((await search(`?q=needle&before=${page.next}`)).body)
  assert.deepEqual(
    older.blurts.map((blurt: { text: string }) => blurt.text),
    ['needle 1'],
  )
  assert.equal(older.next, null)
})

test('the blurt text search uses its GIN index', async () => {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    // A test table is tiny, so the planner would rightly scan it; take that option away to
    // see that the query's expression matches the index at all.
    await client.query('SET LOCAL enable_seqscan = off')
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT r.id FROM blurts r WHERE ${blurtSearchWhere}`,
      ['cat'],
    )
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n')
    assert.match(plan, /Bitmap Index Scan on blurts_text_search_idx/, plan)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

test('searching too often from one IP gets a 429', async () => {
  await withRealRateLimits(async () => {
    const statuses: number[] = []
    for (let i = 0; i < 61; i++) {
      statuses.push((await search('?q=cat', from('203.0.113.9', json))).statusCode)
    }
    assert.deepEqual(statuses.slice(0, 60), Array(60).fill(200))
    assert.equal(statuses[60], 429)
    assert.equal((await search('?q=cat', from('203.0.113.10', json))).statusCode, 200)
  })
})
