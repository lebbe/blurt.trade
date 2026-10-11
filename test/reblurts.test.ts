import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { embedPendingBlurts } from '../src/embeddings.ts'
import { deleteStaleReblurts } from '../src/routes/state.ts'
import {
  blurtIdByText,
  blurtRow,
  createSession,
  followFirst,
  insertBlurt,
  insertFollowees,
  json,
  request,
  search,
  sendJson,
  stats,
  withRealRateLimits,
} from './helpers.ts'

async function plainReblurtRows(): Promise<{ user_id: number; reblurt_of_id: number }[]> {
  const { rows } = await db().query(
    `SELECT user_id, reblurt_of_id FROM blurts
     WHERE reblurt_of_id IS NOT NULL AND text IS NULL AND deleted_at IS NULL ORDER BY id`,
  )
  return rows
}

type ListedBlurt = {
  id: number
  text: string | null
  username: string | null
  reblurtedBy: string | null
  reblurtCount: number
  viewerReblurted: boolean
  quoted: { id: number; text: string | null; username: string | null; deleted: boolean } | null
}

// Inserts a plain reblurt by `username` of blurt `id`, `at` ms from now.
async function insertReblurt(username: string, id: number, at: number): Promise<void> {
  await db().query(
    `INSERT INTO blurts (user_id, reblurt_of_id, reblurt_of_user_id, created_at)
     SELECT u.id, b.id, b.user_id, $3 FROM users u, blurts b WHERE u.username = $1 AND b.id = $2`,
    [username, id, new Date(Date.now() + at)],
  )
}

test('reblurts and un-reblurts from the feed, a profile and a blurt page without JS', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Worth+repeating', { cookie: larsCookie })
  const id = await blurtIdByText('Worth repeating')
  const reblurtForm = new RegExp(
    `action="/api/reblurt"[^>]*>\\s*<input type="hidden" name="blurtId" value="${id}"`,
  )
  const undoForm = new RegExp(
    `action="/api/unreblurt"[^>]*>\\s*<input type="hidden" name="blurtId" value="${id}"`,
  )

  // Anonymous visitors see the count, no button; the author can't reblurt their own blurt.
  const anonymous = await request('GET', '/')
  assert.match(anonymous.body, /0 reblurts/)
  assert.doesNotMatch(anonymous.body, /api\/(un)?reblurt|#quote/)
  const own = await request('GET', '/', '', { cookie: larsCookie })
  assert.doesNotMatch(own.body, reblurtForm)
  assert.match(own.body, new RegExp(`href="/Lars/${id}#quote"`)) // quoting yourself is fine

  for (const page of ['/', '/Lars/', `/Lars/${id}`]) {
    assert.match((await request('GET', page, '', { cookie: adaCookie })).body, reblurtForm, page)
    const reblurted = await request('POST', '/api/reblurt', `blurtId=${id}`, {
      cookie: adaCookie,
      host: 'blurt.test',
      referer: `http://blurt.test${page}`,
    })
    assert.equal(reblurted.statusCode, 303)
    assert.equal(reblurted.location, `${page}#blurt-${id}`)
    const after = await request('GET', page, '', { cookie: adaCookie })
    assert.match(after.body, undoForm, page)
    assert.match(after.body, /1 reblurt</, page)
    // Reblurting twice does nothing.
    await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: adaCookie })
    assert.equal((await stats(id)).reblurt_count, 1)
    assert.equal((await plainReblurtRows()).length, 1)

    const undone = await request('POST', '/api/unreblurt', `blurtId=${id}`, { cookie: adaCookie })
    assert.equal(undone.statusCode, 303)
    assert.equal(undone.location, `/Lars/${id}`)
    await request('POST', '/api/unreblurt', `blurtId=${id}`, { cookie: adaCookie })
    assert.equal((await stats(id)).reblurt_count, 0)
    // Un-reblurting removes the row, so nothing piles up.
    assert.deepEqual(await plainReblurtRows(), [])
    assert.match((await request('GET', page, '', { cookie: adaCookie })).body, reblurtForm, page)
  }
})

test('reblurts answer JSON callers, follow the rules, and show as JSON and Markdown', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  const bobCookie = await createSession('Bob')
  await request('POST', '/api/blurts', 'text=Carl+says', { cookie: larsCookie })
  const original = await blurtIdByText('Carl says')

  const reblurted = await sendJson('/api/reblurt', { blurtId: original }, { cookie: adaCookie })
  assert.equal(reblurted.statusCode, 200)
  assert.deepEqual(JSON.parse(reblurted.body), {
    blurtId: original,
    reblurtCount: 1,
    viewerReblurted: true,
  })
  const { rows: adaRows } = await db().query(
    'SELECT id, reblurt_of_user_id FROM blurts WHERE user_id = 2 AND reblurt_of_id = $1',
    [original],
  )
  const adaReblurt = adaRows[0]
  assert.equal(adaReblurt.reblurt_of_user_id, 1) // the original's author, for sharding

  // Reblurting Ada's reblurt stores Lars's blurt: reads resolve in one step.
  const viaReblurt = await sendJson(
    '/api/reblurt',
    { blurtId: adaReblurt.id },
    { cookie: bobCookie },
  )
  assert.deepEqual(JSON.parse(viaReblurt.body), {
    blurtId: original,
    reblurtCount: 2,
    viewerReblurted: true,
  })
  assert.deepEqual(await plainReblurtRows(), [
    { user_id: 2, reblurt_of_id: original },
    { user_id: 3, reblurt_of_id: original },
  ])

  // A plain reblurt can't be liked, replied to or reported itself: those go to the original.
  const liked = await sendJson('/api/like', { blurtId: adaReblurt.id }, { cookie: bobCookie })
  assert.deepEqual(JSON.parse(liked.body), { blurtId: original, likeCount: 1, viewerLikes: true })
  const reply = await sendJson(
    '/api/blurts',
    { parentId: adaReblurt.id, text: 'To the original' },
    { cookie: bobCookie },
  )
  assert.equal(JSON.parse(reply.body).parentId, original)
  await request('POST', '/api/report', `blurtId=${adaReblurt.id}`, { cookie: bobCookie })
  const { rows: reports } = await db().query('SELECT blurt_id FROM reports')
  assert.deepEqual(reports, [{ blurt_id: original }])
  // It has no page of its own, and isn't deleted as a blurt: it is un-reblurted.
  assert.equal((await request('GET', `/Ada/${adaReblurt.id}`)).statusCode, 404)
  assert.equal((await request('GET', `/Lars/${adaReblurt.id}`)).statusCode, 404)
  const deleteReblurt = await sendJson(
    `/api/blurts/${adaReblurt.id}/delete`,
    {},
    { cookie: larsCookie },
  )
  assert.equal(deleteReblurt.statusCode, 404)

  // No reblurting your own blurt, or what isn't there.
  const own = await sendJson('/api/reblurt', { blurtId: original }, { cookie: larsCookie })
  assert.equal(own.statusCode, 400)
  assert.match(JSON.parse(own.body).error, /your own blurt/)
  const cases: [string, unknown, Record<string, string>, number][] = [
    ['/api/reblurt', { blurtId: 999 }, { cookie: adaCookie }, 404],
    ['/api/reblurt', { blurtId: 'x' }, { cookie: adaCookie }, 404],
    ['/api/unreblurt', {}, { cookie: adaCookie }, 404],
    ['/api/reblurt', { blurtId: original }, {}, 401],
    ['/api/unreblurt', { blurtId: original }, {}, 401],
  ]
  for (const [path, body, headers, status] of cases) {
    const response = await sendJson(path, body, headers)
    assert.equal(response.statusCode, status, `${path} ${JSON.stringify(body)}`)
    assert.equal(typeof JSON.parse(response.body).error, 'string')
  }

  // On Ada's profile: Lars's blurt, reblurted by Ada, with the counts and the viewer's flags.
  const profile = JSON.parse(
    (await request('GET', '/Ada/', '', { ...json, cookie: bobCookie })).body,
  )
  assert.deepEqual(
    profile.blurts.map((blurt: ListedBlurt) => [
      blurt.id,
      blurt.username,
      blurt.text,
      blurt.reblurtedBy,
      blurt.reblurtCount,
      blurt.viewerReblurted,
    ]),
    [[original, 'Lars', 'Carl says', 'Ada', 2, true]],
  )
  const html = await request('GET', '/Ada/', '')
  assert.match(html.body, /Reblurted by <a href="\/Ada\/">Ada<\/a>[^]*Carl says/)
  const markdown = await request('GET', `/Lars/${original}`, '', {
    accept: 'text/markdown',
    cookie: adaCookie,
  })
  assert.match(markdown.body, /2 reblurts \(you reblurted it\)/)
  assert.match(markdown.body, /Undo your reblurt with `POST \/api\/unreblurt`/)
  assert.match(markdown.body, /Quote it with `POST \/api\/blurts`, `text` and `reblurtOfId=/)
  const adaMarkdown = await request('GET', '/Ada/', '', { accept: 'text/markdown' })
  assert.match(adaMarkdown.body, /### Lars\n\nReblurted by \[Ada\]\(<\/Ada\/>\)/)

  // Not in the everyone feed: the original is there already, once.
  const everyone = JSON.parse((await request('GET', '/everyone', '', json)).body)
  assert.deepEqual(
    everyone.blurts.map((blurt: ListedBlurt) => [blurt.text, blurt.reblurtedBy]),
    [['Carl says', null]],
  )
})

test('reblurts of replies say what they reply to, and quoting works without JS', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Top+take', { cookie: larsCookie })
  const top = await blurtIdByText('Top take')
  await request('POST', '/api/blurts', `parentId=${top}&text=Sharp+reply`, { cookie: larsCookie })
  const reply = await blurtIdByText('Sharp reply')
  await request('POST', '/api/reblurt', `blurtId=${reply}`, { cookie: adaCookie })
  const profile = await request('GET', '/Ada/', '')
  assert.match(
    profile.body,
    new RegExp(`Reblurted by[^]*Replying to <a href="/Lars/${top}">Lars</a>[^]*Sharp reply`),
  )

  // The quote form is on the blurt's page; it posts a blurt with reblurtOfId.
  const page = await request('GET', `/Lars/${top}`, '', { cookie: adaCookie })
  assert.match(
    page.body,
    new RegExp(
      `id="quote"[^]*action="/api/blurts"[^]*name="reblurtOfId" value="${top}"[^]*name="text"`,
    ),
  )
  const quoted = await request('POST', '/api/blurts', `reblurtOfId=${top}&text=My+take`, {
    cookie: adaCookie,
  })
  assert.equal(quoted.statusCode, 303)
  const quote = await blurtIdByText('My take')
  assert.equal(quoted.location, `/Ada/${quote}`)
  const quotePage = await request('GET', `/Ada/${quote}`)
  assert.match(quotePage.body, /My take[^]*<blockquote class="quoted">[^]*Lars[^]*Top take/)
  // A quote's validation errors re-render the quoted blurt's page, in the quote form.
  const invalid = await request('POST', '/api/blurts', `reblurtOfId=${top}&text=`, {
    cookie: adaCookie,
  })
  assert.equal(invalid.statusCode, 400)
  assert.match(invalid.body, /id="quote"[^]*Blurt is required[^]*name="reblurtOfId"/)
})

test('a quote-reblurt is content: liked, replied to, searched and embedded', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=a+cat+claim', { cookie: larsCookie })
  const original = await blurtIdByText('a cat claim')
  // A plain reblurt too, by Ada, for the embedding job and search to skip.
  await request('POST', '/api/reblurt', `blurtId=${original}`, { cookie: adaCookie })

  const created = await sendJson(
    '/api/blurts',
    { reblurtOfId: original, text: 'quoting this cat' },
    { cookie: adaCookie },
  )
  assert.equal(created.statusCode, 201)
  const quote = JSON.parse(created.body)
  assert.equal(quote.text, 'quoting this cat')
  assert.equal(quote.quoted.id, original)
  assert.equal(quote.quoted.username, 'Lars')
  assert.equal(quote.quoted.text, 'a cat claim')
  assert.equal(quote.quoted.deleted, false)
  // Quoting yourself, and the same blurt twice, is fine.
  const again = await sendJson(
    '/api/blurts',
    { reblurtOfId: original, text: 'once more' },
    { cookie: larsCookie },
  )
  assert.equal(again.statusCode, 201)
  // A quote of a quote points at the quote; only one level is shown.
  const nested = await sendJson(
    '/api/blurts',
    { reblurtOfId: quote.id, text: 'quote of a quote' },
    { cookie: larsCookie },
  )
  const nestedQuote = JSON.parse(nested.body)
  assert.equal(nestedQuote.quoted.id, quote.id)
  assert.equal(nestedQuote.quoted.text, 'quoting this cat')
  assert.equal('quoted' in nestedQuote.quoted, false)
  // Quoting a plain reblurt quotes its original.
  const { rows: plain } = await db().query('SELECT id FROM blurts WHERE text IS NULL')
  const viaReblurt = await sendJson(
    '/api/blurts',
    { reblurtOfId: plain[0].id, text: 'via a reblurt' },
    { cookie: larsCookie },
  )
  assert.equal(JSON.parse(viaReblurt.body).quoted.id, original)
  // Not a reply and a quote at once; not of what isn't there.
  const both = await sendJson(
    '/api/blurts',
    { parentId: original, reblurtOfId: original, text: 'both' },
    { cookie: larsCookie },
  )
  assert.equal(both.statusCode, 400)
  const missing = await sendJson(
    '/api/blurts',
    { reblurtOfId: 999, text: 'nothing' },
    { cookie: larsCookie },
  )
  assert.equal(missing.statusCode, 404)

  const liked = await sendJson('/api/like', { blurtId: quote.id }, { cookie: larsCookie })
  assert.equal(JSON.parse(liked.body).likeCount, 1)
  const reply = await sendJson(
    '/api/blurts',
    { parentId: quote.id, text: 'reply to a quote' },
    { cookie: larsCookie },
  )
  assert.equal(reply.statusCode, 201)

  // The embedding job skips the plain reblurt, and embeds the quotes.
  await embedPendingBlurts()
  const { rows } = await db().query(
    `SELECT text, embedding IS NOT NULL AS embedded FROM blurts
     WHERE reblurt_of_id IS NOT NULL ORDER BY id`,
  )
  assert.deepEqual(rows, [
    { text: null, embedded: false },
    { text: 'quoting this cat', embedded: true },
    { text: 'once more', embedded: true },
    { text: 'quote of a quote', embedded: true },
    { text: 'via a reblurt', embedded: true },
  ])
  const { rows: waiting } = await db().query(
    'SELECT count(*)::int AS count FROM blurts WHERE embedding IS NULL AND text IS NOT NULL',
  )
  assert.equal(waiting[0].count, 0)

  // Search finds the quote by its own text, and never the plain reblurt.
  const found = JSON.parse((await search('?q=cat')).body)
  assert.deepEqual(
    found.blurts.map((blurt: ListedBlurt) => [blurt.text, blurt.reblurtedBy]).sort(),
    [
      ['a cat claim', null],
      ['quoting this cat', null],
    ],
  )
})

test("reblurts appear in followers' feeds once, at the newest reblurt", async () => {
  const cookie = await createSession('Eve')
  await insertFollowees(12)
  await followFirst('Eve', 11) // the following feed is at /
  await createSession('Carl')
  await insertBlurt('Carl', 'Carl, not followed', new Date(Date.now() - 60_000))
  const carls = await blurtIdByText('Carl, not followed')
  const user1Top = await blurtIdByText('top from user1')

  // Two people Eve follows reblurt Carl's blurt; one reblurts a followed user's blurt.
  await insertReblurt('user2', carls, 10_000)
  await insertReblurt('user3', carls, 20_000)
  await insertReblurt('user4', user1Top, 30_000)
  await insertReblurt('user12', user1Top, 40_000) // not followed by Eve

  const home = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.equal(home.feed, 'following')
  const listed: [string, string | null][] = home.blurts.map((blurt: ListedBlurt) => [
    blurt.text,
    blurt.reblurtedBy,
  ])
  assert.deepEqual(listed.slice(0, 2), [
    ['top from user1', 'user4'],
    ['Carl, not followed', 'user3'],
  ])
  assert.equal(listed.filter(([text]) => text === 'top from user1').length, 1)
  assert.equal(listed.filter(([text]) => text === 'Carl, not followed').length, 1)
  assert.equal(home.blurts.length, 12)
  // Shown as the original: its replies inline, buttons on the original.
  assert.deepEqual(
    home.blurts[0].replies.map((reply: { text: string }) => reply.text),
    ['reply'],
  )
  const html = await request('GET', '/', '', { cookie })
  assert.match(html.body, new RegExp(`id="blurt-${user1Top}"[^]*Reblurted by[^]*user4`))

  // With 10 or fewer follows, on top of the everyone feed.
  const kim = await createSession('Kim')
  await followFirst('Kim', 3)
  const kimHome = JSON.parse((await request('GET', '/', '', { ...json, cookie: kim })).body)
  assert.deepEqual(
    kimHome.followedBlurts.slice(0, 1).map((blurt: ListedBlurt) => [blurt.text, blurt.reblurtedBy]),
    [['Carl, not followed', 'user3']],
  )
})

test('an old blurt reblurted shows once across the pages of the following feed', async () => {
  const cookie = await createSession('Eve')
  await insertFollowees(11)
  await followFirst('Eve', 11)
  await db().query(
    `INSERT INTO blurts (user_id, text, created_at)
     SELECT u.id, 'old ' || i, timestamptz '2020-01-01' + i * interval '1 minute'
     FROM users u, generate_series(1, 150) AS i WHERE u.username = 'user5'`,
  )
  const oldest = await blurtIdByText('old 1')
  await insertReblurt('user6', oldest, 60_000)

  const pages: [string, string | null][][] = []
  let url = '/'
  for (;;) {
    const data = JSON.parse((await request('GET', url, '', { ...json, cookie })).body)
    pages.push(data.blurts.map((blurt: ListedBlurt) => [blurt.text, blurt.reblurtedBy]))
    if (data.next === null) {
      break
    }
    url = `/?before=${data.next}`
  }
  assert.equal(pages.length, 2)
  assert.deepEqual(pages[0][0], ['old 1', 'user6'])
  const texts = pages.flat().map(([text]) => text)
  assert.equal(texts.length, 11 + 150)
  assert.equal(new Set(texts).size, texts.length)
})

test('deleting an original hides its plain reblurts at once and keeps quotes and replies', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  const bobCookie = await createSession('Bob')
  await request('POST', '/api/blurts', 'text=Soon+gone', { cookie: larsCookie })
  const original = await blurtIdByText('Soon gone')
  await request('POST', '/api/reblurt', `blurtId=${original}`, { cookie: adaCookie })
  await request('POST', '/api/like', `blurtId=${original}`, { cookie: adaCookie })
  await request('POST', '/api/blurts', `reblurtOfId=${original}&text=Bob+quotes`, {
    cookie: bobCookie,
  })
  const quote = await blurtIdByText('Bob quotes')
  await request('POST', '/api/blurts', `parentId=${original}&text=Bob+replies`, {
    cookie: bobCookie,
  })

  await request('POST', `/api/blurts/${original}/delete`, '', { cookie: larsCookie })

  // The row stays, emptied, with its user_id; its likes, counters and plain reblurts go.
  assert.deepEqual(await blurtRow(original), {
    user_id: 1,
    text: null,
    embedding: null,
    deleted: true,
  })
  assert.deepEqual(await plainReblurtRows(), [])
  assert.equal((await db().query('SELECT 1 FROM likes')).rowCount, 0)
  const counters = await db().query('SELECT 1 FROM blurt_stats WHERE blurt_id = $1', [original])
  assert.equal(counters.rowCount, 0)

  // Ada's profile no longer shows it. Bob's quote shows "Content is deleted".
  const ada = JSON.parse((await request('GET', '/Ada/', '', json)).body)
  assert.deepEqual(ada.blurts, [])
  const bob = JSON.parse((await request('GET', '/Bob/', '', json)).body)
  const { createdAt, ...quoted } = bob.blurts.find(
    (blurt: ListedBlurt) => blurt.id === quote,
  ).quoted
  assert.equal(typeof createdAt, 'string')
  assert.deepEqual(quoted, {
    id: original,
    username: null,
    text: null,
    avatar: null,
    deleted: true,
  })
  const quotePage = await request('GET', `/Bob/${quote}`)
  assert.match(quotePage.body, /Bob quotes[^]*Content is deleted\./)
  assert.doesNotMatch(quotePage.body, /Soon gone/)
  const markdown = await request('GET', `/Bob/${quote}`, '', { accept: 'text/markdown' })
  assert.match(markdown.body, /> _Content is deleted\._/)
  // The reply stays under the placeholder.
  const thread = await request('GET', `/deleted/${original}`)
  assert.match(thread.body, /This blurt was deleted\.[^]*Bob replies/)
  // A deleted blurt can't be reblurted or quoted.
  const reblurt = await sendJson('/api/reblurt', { blurtId: original }, { cookie: bobCookie })
  assert.equal(reblurt.statusCode, 404)
  const quoteIt = await sendJson(
    '/api/blurts',
    { reblurtOfId: original, text: 'x' },
    { cookie: bobCookie },
  )
  assert.equal(quoteIt.statusCode, 404)
})

test('stale reblurts are hidden on read, and cleanup is safe to run twice', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Stale+soon', { cookie: larsCookie })
  const original = await blurtIdByText('Stale soon')
  await request('POST', '/api/reblurt', `blurtId=${original}`, { cookie: adaCookie })
  // As if cleanup were late or had crashed: the original is deleted, the reblurt is left.
  await db().query(
    'UPDATE blurts SET deleted_at = now(), text = NULL, embedding = NULL WHERE id = $1',
    [original],
  )
  assert.equal((await plainReblurtRows()).length, 1)
  assert.deepEqual(JSON.parse((await request('GET', '/Ada/', '', json)).body).blurts, [])

  assert.equal(await deleteStaleReblurts(), 1)
  assert.equal(await deleteStaleReblurts(), 0)
  assert.deepEqual(await plainReblurtRows(), [])
})

test('deleting a quote with replies leaves a tombstone, never a plain reblurt', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Quotable', { cookie: larsCookie })
  const original = await blurtIdByText('Quotable')
  await request('POST', '/api/blurts', `reblurtOfId=${original}&text=Ada+quotes`, {
    cookie: adaCookie,
  })
  const quote = await blurtIdByText('Ada quotes')
  await request('POST', '/api/blurts', `parentId=${quote}&text=Lars+answers`, {
    cookie: larsCookie,
  })

  const deleted = await request('POST', `/api/blurts/${quote}/delete`, '', { cookie: adaCookie })
  assert.equal(deleted.statusCode, 303)

  // reblurt_of_id set and no text, but deleted: a tombstone, not a plain reblurt.
  const { rows } = await db().query(
    `SELECT reblurt_of_id, text, user_id, deleted_at IS NOT NULL AS deleted
     FROM blurts WHERE id = $1`,
    [quote],
  )
  assert.deepEqual(rows, [{ reblurt_of_id: original, text: null, user_id: 2, deleted: true }])
  assert.deepEqual(await plainReblurtRows(), [])
  // Ada can still plain-reblurt the original: the tombstone doesn't take the unique slot.
  const reblurted = await sendJson('/api/reblurt', { blurtId: original }, { cookie: adaCookie })
  assert.equal(JSON.parse(reblurted.body).reblurtCount, 1)

  const thread = JSON.parse((await request('GET', `/deleted/${quote}`, '', json)).body)
  assert.equal(thread.blurt.deleted, true)
  assert.equal(thread.blurt.username, null)
  assert.equal(thread.blurt.quoted, null)
  assert.equal(thread.blurt.reblurtedBy, null)
  assert.deepEqual(
    thread.replies.map((reply: { text: string }) => reply.text),
    ['Lars answers'],
  )
  // Not on Ada's profile as itself, nor as the original reblurted.
  const ada = JSON.parse((await request('GET', '/Ada/', '', json)).body)
  assert.deepEqual(
    ada.blurts.map((blurt: ListedBlurt) => [blurt.text, blurt.reblurtedBy]),
    [['Quotable', 'Ada']],
  )
})

test('deleting an account undoes its reblurts and shows no author on its content', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Lars+original', { cookie: larsCookie })
  const larsBlurt = await blurtIdByText('Lars original')
  await request('POST', '/api/blurts', 'text=Ada+original', { cookie: adaCookie })
  const adaBlurt = await blurtIdByText('Ada original')
  await request('POST', '/api/reblurt', `blurtId=${larsBlurt}`, { cookie: adaCookie })
  await request('POST', '/api/reblurt', `blurtId=${adaBlurt}`, { cookie: larsCookie })
  await request('POST', '/api/blurts', `reblurtOfId=${adaBlurt}&text=Lars+quotes+Ada`, {
    cookie: larsCookie,
  })

  const deleted = await request('POST', '/settings/delete', 'password=correct-horse', {
    cookie: larsCookie,
  })
  assert.equal(deleted.statusCode, 303)

  // Lars's reblurt of Ada's blurt is gone, and off her count. Ada's reblurt of Lars's blurt
  // went with it (the original is deleted).
  assert.deepEqual(await plainReblurtRows(), [])
  assert.deepEqual(await stats(adaBlurt), { like_count: 0, reblurt_count: 0 })
  const ada = JSON.parse((await request('GET', '/Ada/', '', json)).body)
  assert.deepEqual(
    ada.blurts.map((blurt: ListedBlurt) => [blurt.text, blurt.reblurtCount]),
    [['Ada original', 0]],
  )
  // Their content stays as rows (user_id kept), which name nobody anywhere.
  const { rows } = await db().query(
    'SELECT count(*)::int AS count FROM blurts WHERE user_id = 1 AND deleted_at IS NOT NULL',
  )
  assert.equal(rows[0].count, 2)
  for (const path of ['/', '/everyone', `/deleted/${larsBlurt}`, '/Ada/', `/Ada/${adaBlurt}`]) {
    const page = await request('GET', path, '', { cookie: adaCookie })
    assert.doesNotMatch(page.body, /Lars/, path)
  }
  assert.deepEqual(JSON.parse((await search('?q=Lars')).body).blurts, [])
})

test('concurrent likes and reblurts of one blurt are all counted', async () => {
  const author = await createSession('Lars')
  const cookies = await Promise.all(
    ['Ada', 'Bob', 'Eve', 'Kim', 'Ola', 'Per'].map((name) => createSession(name)),
  )
  await request('POST', '/api/blurts', 'text=Hot+take', { cookie: author })
  const id = await blurtIdByText('Hot take')

  // Everyone at once, each twice, likes and reblurts mixed.
  await Promise.all(
    [...cookies, ...cookies].flatMap((cookie) => [
      sendJson('/api/like', { blurtId: id }, { cookie }),
      sendJson('/api/reblurt', { blurtId: id }, { cookie }),
    ]),
  )
  assert.deepEqual(await stats(id), { like_count: 6, reblurt_count: 6 })
  await Promise.all(
    [...cookies.slice(0, 4), ...cookies.slice(0, 4)].flatMap((cookie) => [
      sendJson('/api/unlike', { blurtId: id }, { cookie }),
      sendJson('/api/unreblurt', { blurtId: id }, { cookie }),
      sendJson('/api/reblurt', { blurtId: id }, { cookie: author }), // own: refused
    ]),
  )
  assert.deepEqual(await stats(id), { like_count: 2, reblurt_count: 2 })
  assert.equal((await plainReblurtRows()).length, 2)
  const { rows } = await db().query(
    'SELECT count(*)::int AS count FROM likes WHERE blurt_id = $1',
    [id],
  )
  assert.equal(rows[0].count, 2)
})

test('reblurting is limited per account', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Spam+target', { cookie: larsCookie })
  const id = await blurtIdByText('Spam target')
  await withRealRateLimits(async () => {
    const statuses: number[] = []
    for (let i = 0; i < 61; i++) {
      const path = i % 2 === 0 ? '/api/reblurt' : '/api/unreblurt'
      statuses.push((await sendJson(path, { blurtId: id }, { cookie: adaCookie })).statusCode)
    }
    assert.deepEqual(statuses.slice(0, 60), Array(60).fill(200))
    assert.equal(statuses[60], 429)
  })
})

test('the database keeps reblurts and stub users consistent even if the app does not', async () => {
  const cookie = await createSession('Lars')
  await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Base', { cookie })
  const id = await blurtIdByText('Base')
  const insert = (columns: string, values: string) =>
    db().query(`INSERT INTO blurts (${columns}) VALUES (${values})`, [id])
  await assert.rejects(insert('user_id, reblurt_of_id', '2, $1'), /blurts_reblurt_of_user/)
  await assert.rejects(
    insert('user_id, reblurt_of_id, reblurt_of_user_id, parent_id', '2, $1, 1, $1'),
    /blurts_plain_reblurt_not_reply/,
  )
  await insert('user_id, reblurt_of_id, reblurt_of_user_id', '2, $1, 1')
  await assert.rejects(
    insert('user_id, reblurt_of_id, reblurt_of_user_id', '2, $1, 1'),
    /blurts_plain_reblurt_key/,
  )
  await assert.rejects(
    db().query('INSERT INTO blurts (user_id) VALUES (2)'),
    /blurts_deleted_removes_content/,
  )
  await assert.rejects(
    db().query(`UPDATE users SET deleted_at = now() WHERE username = 'Ada'`),
    /users_deleted_is_stub/,
  )
})
