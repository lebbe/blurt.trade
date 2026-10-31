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
  const stored = await db().query<{ shapes: Buffer }>('SELECT shapes FROM blurt_pictures')
  assert.deepEqual(data.blurts[0].picture, {
    width: 640,
    height: 320,
    url: `/pictures/${id}.svg`,
    data: stored.rows[0].shapes.toString('base64'),
  })
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

test('?pictures= picks how JSON gives a picture: base64 data, SVG, or neither', async () => {
  const cookie = await createSession('poet')
  const { body, headers } = withPicture('Pictured', samplePng())
  assert.equal((await request('POST', '/api/blurts', body, { ...headers, cookie })).statusCode, 303)
  const id = await blurtIdByText('Pictured')
  const svg = (await request('GET', `/pictures/${id}.svg`)).body
  const pictureIn = async (path: string) => {
    const data = JSON.parse((await request('GET', path, '', json)).body)
    return (data.blurts?.[0] ?? data.blurt).picture
  }
  const base = { width: 640, height: 320, url: `/pictures/${id}.svg` }
  assert.deepEqual(await pictureIn('/?pictures=svg'), { ...base, svg })
  assert.deepEqual(await pictureIn('/?pictures=none'), base)
  assert.ok((await pictureIn('/?pictures=bogus')).data)
  // Also on a single blurt, in search and on the profile.
  assert.ok((await pictureIn(`/poet/${id}`)).data)
  assert.ok((await pictureIn('/poet/')).data)
  assert.deepEqual(await pictureIn(`/poet/${id}?pictures=none`), base)
})

test('a blurt with a picture is shared with a JPEG card drawn on the picture', async () => {
  const cookie = await createSession('poet')
  const { body, headers } = withPicture('Look at this', samplePng())
  assert.equal((await request('POST', '/api/blurts', body, { ...headers, cookie })).statusCode, 303)
  const id = await blurtIdByText('Look at this')
  const page = (await request('GET', `/poet/${id}`)).body
  const imagePath = page.match(/property="og:image" content="https:\/\/blurt\.trade([^"]+)"/)?.[1]
  assert.match(imagePath ?? '', new RegExp(`^/og/${id}-[a-f0-9]{64}\\.jpg$`))
  assert.match(page, /property="og:image:type" content="image\/jpeg"/)
  assert.match(page, /property="og:image:width" content="1200"/)
  assert.match(page, new RegExp(`name="twitter:image" content="https://blurt\\.trade${imagePath}"`))

  const card = await request('GET', imagePath!)
  assert.equal(card.statusCode, 200)
  assert.match(card.contentType ?? '', /^image\/jpeg/)
  assert.equal(card.headers['cache-control'], 'public, max-age=31536000, immutable')
  assert.deepEqual([...card.bodyBytes.subarray(0, 3)], [0xff, 0xd8, 0xff])
  assert.ok(card.bodyBytes.length < 1024 * 1024)
  // The PNG name of the same card, and a stale hash, redirect to the JPEG.
  const png = await request('GET', imagePath!.replace(/\.jpg$/, '.png'))
  assert.equal(png.statusCode, 302)
  assert.equal(png.location, imagePath)
  assert.equal((await request('GET', `/og/${id}.jpg`)).location, imagePath)

  // A blurt without a picture keeps its PNG card, and its .jpg name redirects there.
  await request('POST', '/api/blurts', 'text=plain words', { cookie })
  const plainId = await blurtIdByText('plain words')
  const plain = (await request('GET', `/poet/${plainId}`)).body
  const plainPath = plain.match(/property="og:image" content="https:\/\/blurt\.trade([^"]+)"/)?.[1]
  assert.match(plainPath ?? '', /\.png$/)
  assert.match(plain, /property="og:image:type" content="image\/png"/)
  assert.equal((await request('GET', plainPath!.replace(/\.png$/, '.jpg'))).location, plainPath)

  await request('POST', `/api/blurts/${id}/delete`, '', { cookie })
  assert.equal((await request('GET', imagePath!)).statusCode, 404)
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

test('pictures are drawn in the worker pool, and a busy pool answers 503', async () => {
  const cookie = await createSession()
  const { drawPicture } = await import('../src/picture-pool.ts')
  const png = samplePng(300, 300)
  const drawn = await drawPicture(Buffer.from(png))
  assert.deepEqual([drawn?.width, drawn?.height], [640, 640])
  assert.equal(await drawPicture(Buffer.from('not an image')), undefined)

  const many = Array.from({ length: 30 }, () => drawPicture(Buffer.from(png)))
  const results = await Promise.allSettled(many)
  assert.ok(results.some((r) => r.status === 'rejected'))
  assert.ok(results.some((r) => r.status === 'fulfilled'))

  const { body, headers } = withPicture('After the rush', png)
  const response = await request('POST', '/api/blurts', body, { ...headers, cookie })
  assert.equal(response.statusCode, 303)
})
