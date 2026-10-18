import test from 'node:test'
import assert from 'node:assert/strict'
import { pictureMaxUploadBytes } from '../src/limits.ts'
import { db } from '../src/db.ts'
import {
  blurtIdByText,
  countBlurts,
  createSession,
  json,
  multipart,
  request,
  samplePng,
} from './helpers.ts'

function withPicture(text: string, content: Buffer) {
  return multipart({ text }, { name: 'picture', filename: 'photo.png', type: 'image/png', content })
}

test('a blurt with a picture is shown as a drawing, and the upload is never stored', async () => {
  const cookie = await createSession()
  const { body, headers } = withPicture('With picture', samplePng())
  const response = await request('POST', '/api/blurts', body, { ...headers, cookie })
  assert.equal(response.statusCode, 303)

  const id = await blurtIdByText('With picture')
  const picture = await request('GET', `/pictures/${id}.svg`)
  assert.equal(picture.statusCode, 200)
  assert.match(picture.contentType ?? '', /^image\/svg\+xml/)
  assert.equal(picture.headers['cache-control'], 'public, max-age=86400')
  assert.ok(picture.body.startsWith('<svg'))

  const { rows } = await db().query(
    'SELECT width, height, octet_length(shapes) AS size FROM blurt_pictures',
  )
  assert.equal(rows.length, 1)
  assert.ok(rows[0].size < 65536)

  const page = await request('GET', '/')
  assert.match(page.body, new RegExp(`<img[^>]*src="/pictures/${id}\\.svg"[^>]*width="640"`))
  const data = JSON.parse((await request('GET', '/', '', json)).body)
  assert.deepEqual(data.blurts[0].picture, { width: 640, height: 320 })
  const markdown = await request('GET', '/', '', { accept: 'text/markdown' })
  assert.ok(markdown.body.includes(`![Picture](/pictures/${id}.svg)`))
})

test('a blurt without a picture has none', async () => {
  const cookie = await createSession()
  const { body, headers } = multipart({ text: 'Plain' })
  const response = await request('POST', '/api/blurts', body, { ...headers, cookie })
  assert.equal(response.statusCode, 303)
  const data = JSON.parse((await request('GET', '/', '', json)).body)
  assert.equal(data.blurts[0].picture, null)
  assert.equal((await request('GET', '/pictures/1.svg')).statusCode, 404)
})

test('a file that is no picture is a form error and no blurt is saved', async () => {
  const cookie = await createSession()
  const { body, headers } = withPicture('Bad file', Buffer.from('not an image'))
  const response = await request('POST', '/api/blurts', body, {
    ...headers,
    ...json,
    cookie,
  })
  assert.equal(response.statusCode, 400)
  assert.deepEqual(JSON.parse(response.body).errors, [
    { field: 'picture', message: 'Could not read the picture. Use JPEG, PNG or WebP.' },
  ])
  assert.equal(await countBlurts(), 0)
})

test('the picture still needs text', async () => {
  const cookie = await createSession()
  const { body, headers } = withPicture('', samplePng(50, 50))
  const response = await request('POST', '/api/blurts', body, { ...headers, cookie })
  assert.equal(response.statusCode, 400)
  assert.equal(await countBlurts(), 0)
})

test('only the picture field takes a file', async () => {
  const cookie = await createSession()
  const { body, headers } = multipart(
    { text: 'x' },
    { name: 'other', filename: 'a.png', type: 'image/png', content: samplePng(20, 20) },
  )
  const response = await request('POST', '/api/blurts', body, { ...headers, cookie })
  assert.equal(response.statusCode, 400)
  assert.equal(await countBlurts(), 0)
})

test('the picture goes when the blurt is deleted', async () => {
  const cookie = await createSession()
  const { body, headers } = withPicture('Short lived', samplePng(100, 100))
  await request('POST', '/api/blurts', body, { ...headers, cookie })
  const id = await blurtIdByText('Short lived')
  assert.equal((await request('GET', `/pictures/${id}.svg`)).statusCode, 200)

  const deleted = await request('POST', `/api/blurts/${id}/delete`, '', { cookie })
  assert.equal(deleted.statusCode, 303)
  assert.equal((await request('GET', `/pictures/${id}.svg`)).statusCode, 404)
  const { rows } = await db().query('SELECT 1 FROM blurt_pictures')
  assert.equal(rows.length, 0)
})

test('picture paths are strict', async () => {
  assert.equal((await request('GET', '/pictures/abc.svg')).statusCode, 404)
  assert.equal((await request('GET', '/pictures/1.png')).statusCode, 404)
  assert.equal((await request('GET', '/pictures/1234567890123456.svg')).statusCode, 404)
})

test('an upload over the limit is a 413', async () => {
  const cookie = await createSession()
  const { body, headers } = withPicture('Huge', Buffer.alloc(pictureMaxUploadBytes + 1))
  const response = await request('POST', '/api/blurts', body, { ...headers, ...json, cookie })
  assert.equal(response.statusCode, 413)
  assert.equal(JSON.parse(response.body).error, 'Picture is too large')
  assert.equal(await countBlurts(), 0)
})
