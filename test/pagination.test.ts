import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blurtIdByText,
  createSession,
  insertBlurt,
  insertBlurts,
  json,
  request,
} from './helpers.ts'

function blurtTexts(numbers: number[]): string[] {
  return numbers.map((n) => `blurt ${n}`)
}

// Follows `next` cursors through the JSON pages, returning each page's texts.
async function jsonPages(
  path: string,
  param: 'before' | 'after',
  list: (data: Record<string, any>) => { text: string }[],
): Promise<string[][]> {
  const pages: string[][] = []
  let url = path
  for (;;) {
    const response = await request('GET', url, '', json)
    assert.equal(response.statusCode, 200, url)
    const data = JSON.parse(response.body)
    pages.push(list(data).map((blurt) => blurt.text))
    if (data.next === null) {
      return pages
    }
    assert.equal(typeof data.next, 'string')
    url = `${path}?${param}=${data.next}`
  }
}

// Follows the "Older blurts" / "More replies" links through the HTML pages, as a browser
// without JS would.
async function htmlPages(path: string, label: string): Promise<string[][]> {
  const pages: string[][] = []
  let url: string | undefined = path
  while (url) {
    const response = await request('GET', url)
    assert.equal(response.statusCode, 200, url)
    pages.push([...response.body.matchAll(/<p>(blurt \d+)<\/p>/g)].map((match) => match[1]))
    url = new RegExp(`<a href="([^"]+)" rel="next">${label}</a>`).exec(response.body)?.[1]
  }
  return pages
}

test('pages through the feed newest first, with and without JS', async () => {
  await createSession('Lars')
  await insertBlurts(250)
  const newestFirst = blurtTexts(Array.from({ length: 250 }, (_, i) => 250 - i))

  const pages = await jsonPages('/', 'before', (data) => data.blurts)
  assert.deepEqual(
    pages.map((page) => page.length),
    [100, 100, 50],
  )
  assert.deepEqual(pages.flat(), newestFirst)

  const htmlResult = await htmlPages('/', 'Older blurts')
  assert.deepEqual(htmlResult, pages)

  const markdown = await request('GET', '/', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /\[Older blurts\]\(<\/\?before=[\w-]+>\)/)
})

test('adds canonical links on paginated feed and profile pages', async () => {
  await createSession('Lars')
  await insertBlurts(130)

  const feedFirst = JSON.parse((await request('GET', '/', '', json)).body)
  const feedPage = await request('GET', `/?before=${feedFirst.next}`)
  assert.match(feedPage.body, /<link rel="canonical" href="https:\/\/blurt\.trade\/"\/>/)
  assert.doesNotMatch(feedPage.body, /canonical[^>]+before=/)

  const profileFirst = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  const profilePage = await request('GET', `/Lars/?before=${profileFirst.next}`)
  assert.match(profilePage.body, /<link rel="canonical" href="https:\/\/blurt\.trade\/Lars\/"\/>/)
  assert.doesNotMatch(profilePage.body, /canonical[^>]+before=/)
})

test('a page boundary inside blurts with the same created_at loses nothing', async () => {
  await createSession('Lars')
  // All 101 share one timestamp, so only the id orders them across the boundary.
  await insertBlurts(101, null, 1000)

  const pages = await jsonPages('/', 'before', (data) => data.blurts)
  assert.deepEqual(
    pages.map((page) => page.length),
    [100, 1],
  )
  assert.deepEqual(pages[1], ['blurt 1'])
})

test('new blurts do not shift the pages after the first', async () => {
  const cookie = await createSession('Lars')
  await insertBlurts(150)

  const first = JSON.parse((await request('GET', '/', '', json)).body)
  await request('POST', '/api/blurts', 'text=Brand+new', { cookie })
  const second = JSON.parse((await request('GET', `/?before=${first.next}`, '', json)).body)

  assert.equal(first.blurts.at(-1).text, 'blurt 51')
  assert.deepEqual(
    second.blurts.map((blurt: { text: string }) => blurt.text),
    blurtTexts(Array.from({ length: 50 }, (_, i) => 50 - i)),
  )
  assert.equal(second.next, null)
})

test('pages through a profile newest first', async () => {
  await createSession('Lars')
  await insertBlurts(130)

  const pages = await jsonPages('/Lars/', 'before', (data) => data.blurts)
  assert.deepEqual(pages.flat(), blurtTexts(Array.from({ length: 130 }, (_, i) => 130 - i)))
  assert.deepEqual(await htmlPages('/Lars/', 'Older blurts'), pages)

  const markdown = await request('GET', '/Lars/', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /\[Older blurts\]\(<\/Lars\/\?before=[\w-]+>\)/)
})

test('pages through the replies on a blurt page oldest first', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')
  await insertBlurts(120, id)

  const pages = await jsonPages(`/Lars/${id}`, 'after', (data) => data.replies)
  assert.deepEqual(
    pages.map((page) => page.length),
    [100, 20],
  )
  assert.deepEqual(pages.flat(), blurtTexts(Array.from({ length: 120 }, (_, i) => i + 1)))
  assert.deepEqual(await htmlPages(`/Lars/${id}`, 'More replies'), pages)

  const markdown = await request('GET', `/Lars/${id}`, '', { accept: 'text/markdown' })
  assert.ok(markdown.body.includes(`[More replies](</Lars/${id}?after=`))
})

test('rejects malformed cursors', async () => {
  await createSession('Lars')
  await insertBlurt('Lars', 'Hello world', new Date('2026-10-10T12:00:00.000Z'))
  const cursor = (text: string) => Buffer.from(text).toString('base64url')

  for (const query of [
    'before=nonsense',
    `before=${cursor('2026-13-01T00:00:00.000000Z_1')}`,
    `before=${cursor('2026-10-10T12:00:00.000Z_1')}`,
    'before=a&before=b',
  ]) {
    for (const path of ['/', '/Lars/']) {
      const response = await request('GET', `${path}?${query}`, '', json)
      assert.equal(response.statusCode, 400, `${path}?${query}`)
      assert.equal(JSON.parse(response.body).error, 'Invalid cursor')
    }
  }
  const reply = await request('GET', '/Lars/1?after=nonsense', '', json)
  assert.equal(reply.statusCode, 400)
})
