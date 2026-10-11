import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import {
  blurtIdByText,
  blurtRow,
  createSession,
  insertBlurts,
  json,
  request,
  sendJson,
  withRealRateLimits,
} from './helpers.ts'

async function makeAdmin(username: string): Promise<void> {
  await db().query('UPDATE users SET is_admin = true WHERE username = $1', [username])
}

test('reports a blurt once, with an optional reason, without JS', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Spicy+take', { cookie: larsCookie })
  const id = await blurtIdByText('Spicy take')

  const anonymous = await request('POST', '/api/report', `blurtId=${id}`)
  assert.equal(anonymous.statusCode, 401)
  const own = await request('POST', '/api/report', `blurtId=${id}`, { cookie: larsCookie })
  assert.equal(own.statusCode, 400)
  const missing = await request('POST', '/api/report', 'blurtId=999', { cookie: adaCookie })
  assert.equal(missing.statusCode, 404)
  const tooLong = await request('POST', '/api/report', `blurtId=${id}&reason=${'x'.repeat(501)}`, {
    cookie: adaCookie,
  })
  assert.equal(tooLong.statusCode, 400)
  assert.match(tooLong.body, /Reason is too long/)

  const reported = await request('POST', '/api/report', `blurtId=${id}&reason=Rude`, {
    cookie: adaCookie,
  })
  assert.equal(reported.statusCode, 303)
  assert.equal(reported.location, `/Lars/${id}`)
  const page = await request('GET', `/Lars/${id}`, '', { cookie: adaCookie })
  assert.match(page.body, /You reported this blurt\./)
  const data = await request('GET', `/Lars/${id}`, '', { ...json, cookie: adaCookie })
  assert.equal(JSON.parse(data.body).reported, true)

  const twice = await sendJson(
    '/api/report',
    { blurtId: id, reason: 'Again' },
    { cookie: adaCookie },
  )
  assert.equal(twice.statusCode, 204)
  const { rows } = await db().query('SELECT reason FROM reports')
  assert.deepEqual(rows, [{ reason: 'Rude' }])
})

test('the admin sees reported blurts and deletes or dismisses them', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  const ownerCookie = await createSession('Owner')
  await makeAdmin('Owner')
  await request('POST', '/api/blurts', 'text=Bad+blurt', { cookie: larsCookie })
  await request('POST', '/api/blurts', 'text=Fine+blurt', { cookie: larsCookie })
  const bad = await blurtIdByText('Bad blurt')
  const fine = await blurtIdByText('Fine blurt')
  await request('POST', '/api/report', `blurtId=${bad}&reason=Spam`, { cookie: adaCookie })
  await request('POST', '/api/report', `blurtId=${bad}`, { cookie: ownerCookie })
  await request('POST', '/api/report', `blurtId=${fine}&reason=Meh`, { cookie: adaCookie })

  // Only for admins.
  assert.equal((await request('GET', '/admin/reports')).statusCode, 401)
  assert.equal((await request('GET', '/admin/reports', '', { cookie: adaCookie })).statusCode, 403)
  const dismissByOther = await request('POST', '/api/admin/reports/dismiss', `blurtId=${fine}`, {
    cookie: adaCookie,
  })
  assert.equal(dismissByOther.statusCode, 403)

  const page = await request('GET', '/admin/reports', '', { cookie: ownerCookie })
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /Bad blurt[^]*Ada<\/a>: Spam[^]*no reason given[^]*Fine blurt[^]*Meh/)
  assert.match(page.body, new RegExp(`action="/api/blurts/${bad}/delete"`))
  const data = await request('GET', '/admin/reports', '', { ...json, cookie: ownerCookie })
  type Entry = { blurt: { text: string }; reports: { reporter: string; reason: string }[] }
  assert.deepEqual(
    JSON.parse(data.body).reports.map((entry: Entry) => [
      entry.blurt.text,
      entry.reports.map((report) => `${report.reporter}: ${report.reason}`),
    ]),
    [
      ['Bad blurt', ['Ada: Spam', 'Owner: ']],
      ['Fine blurt', ['Ada: Meh']],
    ],
  )
  const markdown = await request('GET', '/admin/reports', '', {
    accept: 'text/markdown',
    cookie: ownerCookie,
  })
  assert.match(
    markdown.body,
    /^# Reports\n[^]*Bad blurt[^]*Spam[^]*`POST \/api\/admin\/reports\/dismiss`/,
  )

  // The admin may delete anyone's blurt; the form goes back to the reports.
  const deleted = await request('POST', `/api/blurts/${bad}/delete`, '', {
    cookie: ownerCookie,
    host: 'blurt.test',
    referer: 'http://blurt.test/admin/reports',
  })
  assert.equal(deleted.statusCode, 303)
  assert.equal(deleted.location, '/admin/reports')
  assert.equal((await blurtRow(bad))?.deleted, true)

  const dismissed = await request('POST', '/api/admin/reports/dismiss', `blurtId=${fine}`, {
    cookie: ownerCookie,
  })
  assert.equal(dismissed.statusCode, 303)
  assert.equal(dismissed.location, '/admin/reports')
  assert.notEqual(await blurtRow(fine), undefined)
  const empty = await request('GET', '/admin/reports', '', { cookie: ownerCookie })
  assert.match(empty.body, /No open reports\./)
})

test('reporting is limited per account', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await insertBlurts(21)
  const { rows } = await db().query<{ id: number }>('SELECT id FROM blurts ORDER BY id')
  await withRealRateLimits(async () => {
    const statuses: number[] = []
    for (const { id } of rows) {
      const response = await request('POST', '/api/report', `blurtId=${id}`, { cookie: adaCookie })
      statuses.push(response.statusCode)
    }
    assert.deepEqual(statuses, [...Array<number>(20).fill(303), 429])
  })
})
