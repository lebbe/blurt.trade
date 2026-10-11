import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { embedPendingBlurts } from '../src/embeddings.ts'
import { deleteBlurts } from '../src/routes/state.ts'
import {
  blurtIdByText,
  blurtRow,
  countBlurts,
  createSession,
  json,
  request,
  sendJson,
} from './helpers.ts'

test('creates a blurt and redirects back to the feed', async () => {
  const cookie = await createSession()
  const response = await request('POST', '/api/blurts', 'text=Hello+world', { cookie })

  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/')
  const { rows } = await db().query('SELECT user_id, text FROM blurts')
  assert.deepEqual(rows, [{ user_id: 1, text: 'Hello world' }])
})

test('renders submitted input and validation errors for an invalid blurt', async () => {
  const cookie = await createSession()
  const response = await request('POST', '/api/blurts', 'text=', { cookie })

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Blurt is required/)
  assert.equal(await countBlurts(), 0)
})

test('replies to a blurt and shows the thread on the blurt page', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie: larsCookie })
  const id = await blurtIdByText('Original blurt')

  const reply = await request('POST', '/api/blurts', `parentId=${id}&text=Nice+one`, {
    cookie: adaCookie,
  })
  assert.equal(reply.statusCode, 303)
  assert.equal(reply.location, `/Lars/${id}`)

  const page = await request('GET', `/Lars/${id}`)
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /Original blurt/)
  assert.match(page.body, /Nice one/)

  const replyId = await blurtIdByText('Nice one')
  const replyPage = await request('GET', `/Ada/${replyId}`)
  assert.match(replyPage.body, /In reply to/)
  assert.match(replyPage.body, /Original blurt/)
})

test('re-renders the blurt page with the error for an invalid reply', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')

  const response = await request('POST', '/api/blurts', `parentId=${id}&text=`, { cookie })

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Blurt is required/)
  assert.match(response.body, /Original blurt/)
  assert.equal(await countBlurts(), 1)
})

test('rejects replies without authentication', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')

  const response = await request('POST', '/api/blurts', `parentId=${id}&text=Hi`)

  assert.equal(response.statusCode, 401)
  assert.equal(await countBlurts(), 1)
})

test('returns 404 for a blurt under the wrong username', async () => {
  await createSession('Ada')
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')

  const response = await request('GET', `/Ada/${id}`)

  assert.equal(response.statusCode, 404)
})

test('the author deletes their blurt, without JS; nobody else can', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Regret+this', { cookie: larsCookie })
  const id = await blurtIdByText('Regret this')

  const page = await request('GET', '/', '', { cookie: larsCookie })
  assert.match(page.body, new RegExp(`action="/api/blurts/${id}/delete"`))
  const othersView = await request('GET', '/', '', { cookie: adaCookie })
  assert.doesNotMatch(othersView.body, /\/delete"/)
  assert.match(othersView.body, /action="\/api\/report"/)

  const anonymous = await request('POST', `/api/blurts/${id}/delete`)
  assert.equal(anonymous.statusCode, 401)
  const forbidden = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: adaCookie })
  assert.equal(forbidden.statusCode, 403)
  const forbiddenJson = await sendJson(`/api/blurts/${id}/delete`, {}, { cookie: adaCookie })
  assert.equal(forbiddenJson.statusCode, 403)
  assert.equal(typeof JSON.parse(forbiddenJson.body).error, 'string')
  assert.equal(await countBlurts(), 1)

  // Back to the page the form was on, when that is on this site.
  const deleted = await request('POST', `/api/blurts/${id}/delete`, '', {
    cookie: larsCookie,
    host: 'blurt.test',
    referer: 'http://blurt.test/Lars/?before=x',
  })
  assert.equal(deleted.statusCode, 303)
  assert.equal(deleted.location, '/Lars/?before=x')
  // The row stays, marked and emptied; its page is a placeholder.
  assert.equal(await countBlurts(), 1)
  assert.deepEqual(await blurtRow(id), { user_id: 1, text: null, embedding: null, deleted: true })
  const gone = await request('GET', `/Lars/${id}`)
  assert.match(gone.body, /This blurt was deleted./)
  assert.doesNotMatch(gone.body, /Regret this/)
  assert.doesNotMatch((await request('GET', '/')).body, /Regret this/)
  assert.doesNotMatch((await request('GET', '/Lars/')).body, /This blurt was deleted/)

  const again = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: larsCookie })
  assert.equal(again.statusCode, 404)

  // JSON callers get a 204. From its own page, or another site, a form goes to the feed.
  await request('POST', '/api/blurts', 'text=Also+this', { cookie: larsCookie })
  const second = await blurtIdByText('Also this')
  assert.equal(
    (await sendJson(`/api/blurts/${second}/delete`, {}, { cookie: larsCookie })).statusCode,
    204,
  )
  await request('POST', '/api/blurts', 'text=And+this', { cookie: larsCookie })
  const third = await blurtIdByText('And this')
  const fromOwnPage = await request('POST', `/api/blurts/${third}/delete`, '', {
    cookie: larsCookie,
    host: 'blurt.test',
    referer: `http://blurt.test/Lars/${third}`,
  })
  assert.equal(fromOwnPage.location, '/')
  for (const referer of ['http://evil.test/somewhere', 'http://blurt.test//evil.test/x']) {
    await request('POST', '/api/blurts', 'text=One+more', { cookie: larsCookie })
    const id = await blurtIdByText('One more')
    const fromElsewhere = await request('POST', `/api/blurts/${id}/delete`, '', {
      cookie: larsCookie,
      host: 'blurt.test',
      referer,
    })
    assert.equal(fromElsewhere.location, '/', referer)
  }
})

test('a deleted blurt with replies stays as a placeholder, its text and embedding gone', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=my+cat+opinion', { cookie: larsCookie })
  const id = await blurtIdByText('my cat opinion')
  await request('POST', '/api/blurts', `parentId=${id}&text=cat+reply`, { cookie: adaCookie })
  const replyId = await blurtIdByText('cat reply')
  await request('POST', '/api/report', `blurtId=${id}`, { cookie: adaCookie })
  await embedPendingBlurts()
  assert.notEqual((await blurtRow(id))?.embedding, null)

  const deleted = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: larsCookie })
  assert.equal(deleted.statusCode, 303)
  assert.equal(deleted.location, '/')

  // Nothing of it is left but its place in the thread: no text, embedding or reports. The
  // row keeps user_id (the sharding key), but nothing shows who wrote it.
  assert.deepEqual(await blurtRow(id), {
    user_id: 1,
    text: null,
    embedding: null,
    deleted: true,
  })
  const { rows: reports } = await db().query('SELECT * FROM reports')
  assert.deepEqual(reports, [])
  await embedPendingBlurts()
  assert.equal((await blurtRow(id))?.embedding, null)

  // The thread still reads, under the old link and under /deleted/:id.
  for (const path of [`/Lars/${id}`, `/deleted/${id}`]) {
    const page = await request('GET', path, '', { cookie: adaCookie })
    assert.equal(page.statusCode, 200, path)
    assert.match(page.body, /This blurt was deleted\./)
    assert.match(page.body, /cat reply/)
    assert.doesNotMatch(page.body, /my cat opinion/)
    assert.doesNotMatch(page.body, /name="parentId"/) // no replying to a placeholder
  }
  const data = JSON.parse((await request('GET', `/deleted/${id}`, '', json)).body)
  assert.equal(data.blurt.deleted, true)
  assert.equal(data.blurt.username, null)
  assert.equal(data.blurt.text, null)
  assert.equal(data.blurt.avatar, null)
  assert.deepEqual(
    data.replies.map((reply: { text: string }) => reply.text),
    ['cat reply'],
  )
  const markdown = await request('GET', `/deleted/${id}`, '', { accept: 'text/markdown' })
  assert.match(markdown.body, /^# Deleted blurt\n[^]*_This blurt was deleted\._[^]*cat reply/)

  const replyPage = await request('GET', `/Ada/${replyId}`)
  assert.match(replyPage.body, /In reply to[^]*This blurt was deleted\./)
  assert.match(replyPage.body, new RegExp(`href="/deleted/${id}"`))

  // Gone from the feed and the profile, and from related blurts.
  for (const path of ['/', '/Lars/', `/Ada/${replyId}`]) {
    assert.doesNotMatch((await request('GET', path)).body, /my cat opinion/, path)
  }
  const replyData = JSON.parse((await request('GET', `/Ada/${replyId}`, '', json)).body)
  assert.deepEqual(replyData.related, [])

  const reply = await request('POST', '/api/blurts', `parentId=${id}&text=late`, {
    cookie: adaCookie,
  })
  assert.equal(reply.statusCode, 404)
  const deleteAgain = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: larsCookie })
  assert.equal(deleteAgain.statusCode, 404)

  // When its last reply goes too, both rows stay, deleted.
  const lastReply = await request('POST', `/api/blurts/${replyId}/delete`, '', {
    cookie: adaCookie,
  })
  assert.equal(lastReply.statusCode, 303)
  assert.equal(await countBlurts(), 2)
  assert.equal((await blurtRow(replyId))?.deleted, true)
})

test('deleting a whole thread at once keeps every row, deleted', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=top', { cookie })
  const top = await blurtIdByText('top')
  await request('POST', '/api/blurts', `parentId=${top}&text=middle`, { cookie })
  const middle = await blurtIdByText('middle')
  await request('POST', '/api/blurts', `parentId=${middle}&text=bottom`, { cookie })
  const bottom = await blurtIdByText('bottom')

  // Account deletion (025) passes all of a user's blurts at once. Twice is the same.
  await deleteBlurts([top, middle, bottom])
  await deleteBlurts([top, middle, bottom])
  const { rows } = await db().query(
    'SELECT count(*)::int AS count FROM blurts WHERE deleted_at IS NOT NULL AND user_id = 1',
  )
  assert.equal(rows[0].count, 3)
})

test('the database keeps deleted blurts empty, and never drops replies with their parent', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=parent', { cookie })
  const id = await blurtIdByText('parent')
  await request('POST', '/api/blurts', `parentId=${id}&text=child`, { cookie })

  await assert.rejects(
    db().query('UPDATE blurts SET deleted_at = now() WHERE id = $1', [id]),
    /blurts_deleted_removes_content/,
  )
  await assert.rejects(
    db().query('DELETE FROM blurts WHERE id = $1', [id]),
    /blurts_parent_id_fkey/,
  )
})
