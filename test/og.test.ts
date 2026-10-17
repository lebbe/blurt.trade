import test from 'node:test'
import assert from 'node:assert/strict'
import { OG_HEIGHT, OG_WIDTH } from '../src/og.ts'
import { blurtIdByText, createSession, request } from './helpers.ts'

test('crawler requests receive exact metadata and an immutable PNG, then deleted content is 404', async () => {
  const cookie = await createSession('poet')
  const text = 'say <script> & "hello"'
  await request('POST', '/api/blurts', new URLSearchParams({ text }).toString(), { cookie })
  const id = await blurtIdByText(text)
  const headers = { 'user-agent': 'facebookexternalhit/1.1' }
  const page = await request('GET', `/poet/${id}`, '', headers)

  assert.equal(page.statusCode, 200)
  assert.match(page.body, /<title>poet blurted · blurt\.trade<\/title>/)
  const requiredMeta = [
    /name="description" content="say &lt;script> &amp; &quot;hello&quot;"/,
    /property="og:type" content="article"/,
    /property="og:site_name" content="blurt\.trade"/,
    new RegExp(`property="og:url" content="https://blurt\\.trade/poet/${id}"`),
    /property="og:title" content="poet blurted:"/,
    /property="og:description" content="say &lt;script> &amp; &quot;hello&quot;"/,
    /property="og:image" content="https:\/\/blurt\.trade\/og\/\d+-[a-f0-9]{64}\.png"/,
    /property="og:image:type" content="image\/png"/,
    /property="og:image:width" content="1200"/,
    /property="og:image:height" content="630"/,
    /property="og:image:alt" content="poet: say &lt;script> &amp; &quot;hello&quot;"/,
    /property="article:published_time" content="\d{4}-\d\d-\d\dT[^"]+Z"/,
    /name="twitter:card" content="summary_large_image"/,
    /name="twitter:title" content="poet blurted:"/,
    /name="twitter:description" content="say &lt;script> &amp; &quot;hello&quot;"/,
    /name="twitter:image" content="https:\/\/blurt\.trade\/og\/\d+-[a-f0-9]{64}\.png"/,
    /name="theme-color" content="#11152c"/,
  ]
  for (const expression of requiredMeta) {
    assert.match(page.body, expression)
  }

  const imagePath = page.body.match(
    /property="og:image" content="https:\/\/blurt\.trade([^"]+)"/,
  )?.[1]
  assert.ok(imagePath)
  const image = await request('GET', imagePath, '', headers)
  assert.equal(image.statusCode, 200)
  assert.equal(image.contentType, 'image/png')
  assert.equal(image.headers['cache-control'], 'public, max-age=31536000, immutable')
  assert.equal(image.bodyBytes.readUInt32BE(16), OG_WIDTH)
  assert.equal(image.bodyBytes.readUInt32BE(20), OG_HEIGHT)
  assert.ok(image.bodyBytes.length < 1_000_000)

  const crawlers = [
    'facebookexternalhit/1.1',
    'Facebot',
    'Twitterbot',
    'LinkedInBot',
    'Slackbot-LinkExpanding',
    'Discordbot',
    'TelegramBot',
    'WhatsApp',
    'Bluesky Cardyb',
    'Mastodon',
    'Applebot',
  ]
  for (const userAgent of crawlers) {
    const crawlerHeaders = { 'user-agent': userAgent }
    assert.equal(
      (await request('GET', `/poet/${id}`, '', crawlerHeaders)).statusCode,
      200,
      userAgent,
    )
    assert.equal((await request('GET', imagePath, '', crawlerHeaders)).statusCode, 200, userAgent)
  }

  const debug = await request('GET', `${imagePath}?debug=1`)
  assert.equal(debug.statusCode, 200)
  assert.equal(debug.headers['cache-control'], 'no-store')
  assert.equal((await request('GET', '/debug/og')).statusCode, 200)
  const example = await request('GET', '/og/debug/emoji.png?debug=1')
  assert.equal(example.statusCode, 200)
  assert.equal(example.bodyBytes.readUInt32BE(16), OG_WIDTH)
  assert.equal(example.bodyBytes.readUInt32BE(20), OG_HEIGHT)

  await request('POST', `/api/blurts/${id}/delete`, '', { cookie })
  const deleted = await request('GET', `/poet/${id}`, '', headers)
  assert.equal(deleted.statusCode, 200)
  assert.doesNotMatch(deleted.body, /say &lt;script>|hello/)
  assert.match(deleted.body, /og:image" content="https:\/\/blurt\.trade\/static\/og-image\.png"/)
  assert.equal((await request('GET', imagePath, '', headers)).statusCode, 404)
  assert.equal((await request('GET', `/og/${id}-${'0'.repeat(64)}.png`)).statusCode, 404)
  assert.equal((await request('GET', `/og/999999999-${'a'.repeat(64)}.png`)).statusCode, 404)
})
