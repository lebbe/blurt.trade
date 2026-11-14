import test from 'node:test'
import assert from 'node:assert/strict'
import { shareTargets } from '../src/shared/share.ts'

// The Share popup's links (src/shared/share.ts): every value URL-encoded, Pinterest only
// for blurts with a picture.

const url = 'https://blurt.trade/ada/42'
const title = 'Fish & chips? 100% #yes/no 🐟'

test('every service gets the address and title, encoded', () => {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(title)
  const links = Object.fromEntries(
    shareTargets({ url, title, hasPicture: false }).map((target) => [target.id, target.href]),
  )
  assert.deepEqual(links, {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    x: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    email: `mailto:?subject=${t}&body=${u}`,
    reddit: `https://www.reddit.com/submit?url=${u}&title=${t}`,
    bluesky: `https://bsky.app/intent/compose?text=${t}%20${u}`,
    threads: `https://www.threads.net/intent/post?text=${t}%20${u}`,
    mastodon: `https://mastodonshare.com/?text=${t}&url=${u}`,
    whatsapp: `https://api.whatsapp.com/send?text=${t}%20${u}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
  })
  // Nothing in the title can add or end a parameter.
  assert.equal(t, 'Fish%20%26%20chips%3F%20100%25%20%23yes%2Fno%20%F0%9F%90%9F')
  for (const href of Object.values(links)) {
    assert.ok(!href.includes(title))
    assert.ok(!href.includes('&chips'))
  }
  // Read back as a URL, the values are the originals.
  const tweet = new URL(links.x)
  assert.equal(tweet.searchParams.get('url'), url)
  assert.equal(tweet.searchParams.get('text'), title)
  assert.equal(new URL(links.bluesky).searchParams.get('text'), `${title} ${url}`)
})

test('Pinterest only for a blurt with a picture, with the card image when known', () => {
  const ids = (hasPicture: boolean) =>
    shareTargets({ url, title, hasPicture }).map((target) => target.id)
  assert.ok(!ids(false).includes('pinterest'))
  assert.ok(ids(true).includes('pinterest'))

  const pin = (media?: string) =>
    shareTargets({ url, title, hasPicture: true, media }).find((t) => t.id === 'pinterest')!.href
  assert.equal(
    pin(),
    `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(title)}`,
  )
  const media = 'https://blurt.trade/og/42-abc.jpg?x=1&y=2'
  assert.equal(new URL(pin(media)).searchParams.get('media'), media)
  assert.ok(pin(media).endsWith(`&media=${encodeURIComponent(media)}`))
})

test('without a title, the single-text services get only the address', () => {
  const links = shareTargets({ url, title: '', hasPicture: false })
  const bluesky = links.find((t) => t.id === 'bluesky')!.href
  assert.equal(bluesky, `https://bsky.app/intent/compose?text=${encodeURIComponent(url)}`)
})
