import test from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { db } from '../../src/db.ts'
import { randomAvatar } from '../../src/avatar.ts'
import { shareTargets } from '../../src/shared/share.ts'
import { blurtIdByText, insertBlurts } from '../helpers.ts'
import { bothModes, enhancersReady, markWindow, openTab, samePage, signUp } from './helpers.ts'

// Share (src/client/share.ts): without JavaScript a link (the blurt's page in lists, the
// share card image on the blurt's page); with it the page's own address is shared, through
// the browser's share sheet on phones and a popup of links (src/ui/share.ts) elsewhere.

// The test server has no PUBLIC_URL, so the site's default origin.
const origin = 'https://blurt.trade'
const text = 'Fish & chips? 100% #yes'

async function addAda(texts: string[] = [text], bio = ''): Promise<void> {
  await db().query(
    `WITH u AS (INSERT INTO users (username, password_hash) VALUES ('Ada', 'x') RETURNING id),
       p AS (INSERT INTO user_profiles (user_id, avatar, bio) SELECT id, $1::jsonb, $3 FROM u)
     INSERT INTO blurts (user_id, text) SELECT u.id, t FROM u, unnest($2::text[]) AS t`,
    [JSON.stringify(randomAvatar()), texts, bio],
  )
}

function shareLink(page: Page, cardText: string) {
  return page.locator('article.blurt', { hasText: cardText }).first().locator('a[aria-label=Share]')
}

// The popup's links, as [id, href, target, rel].
async function dialogLinks(page: Page): Promise<string[][]> {
  return page.$$eval('dialog.share a[data-share-target]', (links) =>
    links.map((link) => [
      link.getAttribute('data-share-target') ?? '',
      link.getAttribute('href') ?? '',
      link.getAttribute('target') ?? '',
      link.getAttribute('rel') ?? '',
    ]),
  )
}

function expectedLinks(options: Parameters<typeof shareTargets>[0]): string[][] {
  return shareTargets(options).map((target) => [
    target.id,
    target.href,
    target.id === 'email' ? '' : '_blank',
    'noopener noreferrer',
  ])
}

const focusedLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)

bothModes('Share in a list and on the blurt page', async ({ page }, javaScriptEnabled) => {
  await addAda()
  const id = await blurtIdByText(text)
  const url = `${origin}/Ada/${id}`
  await page.goto('/everyone')
  await enhancersReady(page)
  const link = shareLink(page, text)
  assert.equal(await link.getAttribute('href'), `/Ada/${id}`)

  if (!javaScriptEnabled) {
    await link.click()
    await page.waitForURL(`**/Ada/${id}`)
    const card = await page.locator('.thread-main a[aria-label=Share]').getAttribute('href')
    assert.match(card ?? '', /^\/og\/.+\.png$/)
    // Fetched rather than opened: Chromium's own image viewer page trips the image's CSP.
    const response = await page.request.get(card!)
    assert.equal(response.headers()['content-type'], 'image/png')
    return
  }

  await markWindow(page)
  await link.click()
  const dialog = page.locator('dialog.share[open]')
  await dialog.waitFor()
  assert.equal(await dialog.locator('.share-title').textContent(), text)
  assert.equal(await dialog.locator('#share-link').inputValue(), url)
  assert.deepEqual(await dialogLinks(page), expectedLinks({ url, title: text, hasPicture: false }))
  assert.ok(!(await dialogLinks(page)).some(([id]) => id === 'pinterest'))
  // Focus is in the popup (on Copy link), and Escape puts it back on Share.
  assert.equal(
    await page.evaluate(() => document.activeElement?.hasAttribute('data-share-copy')),
    true,
  )
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await focusedLabel(page), 'Share')
  // A click outside closes it too, as does Close.
  await link.click()
  await dialog.waitFor()
  await page.mouse.click(3, 3)
  await dialog.waitFor({ state: 'detached' })
  await link.click()
  await dialog.locator('button', { hasText: 'Close' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.ok(await samePage(page))

  // On the blurt's page Share shares the page, not its card image.
  await page.goto(`/Ada/${id}`)
  await enhancersReady(page)
  await page.click('.thread-main a[aria-label=Share]')
  await dialog.waitFor()
  assert.equal(await dialog.locator('#share-link').inputValue(), url)
  assert.deepEqual(await dialogLinks(page), expectedLinks({ url, title: text, hasPicture: false }))
})

test('Copy link writes the address to the clipboard', async (t) => {
  const { page, problems } = await openTab(t, true, {
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  await addAda()
  const id = await blurtIdByText(text)
  await page.goto('/everyone')
  await enhancersReady(page)
  await shareLink(page, text).click()
  await page.click('dialog.share [data-share-copy]')
  await page.locator('dialog.share .share-status', { hasText: 'Copied!' }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}/Ada/${id}`)
  assert.equal(
    await page.getAttribute('dialog.share .share-status', 'aria-live'),
    'polite',
    'the feedback is read out',
  )
  assert.deepEqual(problems, [])
})

test('Copy link without a clipboard selects the link to copy by hand', async (t) => {
  const { page, problems } = await openTab(t, true)
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined })
  })
  await addAda()
  await page.goto('/everyone')
  await enhancersReady(page)
  await shareLink(page, text).click()
  await page.click('dialog.share [data-share-copy]')
  await page.locator('dialog.share .share-status', { hasText: 'Ctrl+C' }).waitFor()
  const selection = await page.evaluate(() => {
    const field = document.activeElement as HTMLInputElement
    return [field.id, field.selectionStart, field.selectionEnd, field.value.length]
  })
  assert.equal(selection[0], 'share-link')
  assert.equal(selection[1], 0)
  assert.equal(selection[2], selection[3])
  assert.deepEqual(problems, [])
})

// A phone: touch first, so the browser's share sheet (stubbed here: it records what it got,
// or fails the way `outcome` says).
async function phone(t: Parameters<typeof openTab>[0], outcome: 'shared' | string) {
  const tab = await openTab(t, true, {
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  })
  await tab.page.addInitScript((outcome) => {
    const calls: unknown[] = []
    ;(window as unknown as { shared: unknown[] }).shared = calls
    navigator.share = async (data) => {
      calls.push(data)
      if (outcome !== 'shared') {
        throw new DOMException('Stubbed', outcome)
      }
    }
  }, outcome)
  return tab
}

const shared = (page: Page) =>
  page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)

test('on a phone Share opens the share sheet with the page and its text', async (t) => {
  const { page, problems } = await phone(t, 'shared')
  await addAda()
  const id = await blurtIdByText(text)
  await page.goto('/everyone')
  await enhancersReady(page)
  assert.ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
  await markWindow(page)
  await shareLink(page, text).tap()
  await page.waitForFunction(() => (window as unknown as { shared: unknown[] }).shared.length > 0)
  assert.deepEqual(await shared(page), [{ url: `${origin}/Ada/${id}`, title: text, text }])
  assert.equal(await page.locator('dialog.share').count(), 0)
  assert.ok(await samePage(page))
  assert.deepEqual(problems, [])
})

test('on a phone, cancelling the share sheet does nothing; another failure opens the popup', async (t) => {
  const cancelled = await phone(t, 'AbortError')
  await addAda()
  await cancelled.page.goto('/everyone')
  await enhancersReady(cancelled.page)
  await shareLink(cancelled.page, text).tap()
  await cancelled.page.waitForFunction(
    () => (window as unknown as { shared: unknown[] }).shared.length > 0,
  )
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(await cancelled.page.locator('dialog.share').count(), 0)
  assert.ok(cancelled.page.url().endsWith('/everyone'))
  assert.deepEqual(cancelled.problems, [])

  const refused = await phone(t, 'NotAllowedError')
  await refused.page.goto('/everyone')
  await enhancersReady(refused.page)
  await shareLink(refused.page, text).tap()
  await refused.page.locator('dialog.share[open]').waitFor()
  assert.deepEqual(refused.problems, [])
})

test('a computer with navigator.share still gets the popup', async (t) => {
  const { page, problems } = await openTab(t, true)
  await page.addInitScript(() => {
    navigator.share = async () => {
      throw new Error('should not be called')
    }
  })
  await addAda()
  await page.goto('/everyone')
  await enhancersReady(page)
  assert.ok(!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)))
  await shareLink(page, text).click()
  await page.locator('dialog.share[open]').waitFor()
  assert.deepEqual(problems, [])
})

test('Pinterest for a blurt with a picture, with its card image on its page', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await enhancersReady(page)
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(300, 200)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#d4001c'
    context.fillRect(50, 50, 200, 100)
    const body = new FormData()
    body.append('text', 'A picture')
    body.append('picture', await canvas.convertToBlob({ type: 'image/png' }), 'red.png')
    const response = await fetch('/api/blurts', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    })
    if (!response.ok) {
      throw new Error(`${response.status}`)
    }
  })
  const id = await blurtIdByText('A picture')
  const url = `${origin}/Lars/${id}`
  const title = 'A picture'

  // In a list the card image isn't known: Pinterest picks the page's own og:image.
  await page.reload()
  await enhancersReady(page)
  await shareLink(page, title).click()
  await page.locator('dialog.share[open]').waitFor()
  assert.deepEqual(await dialogLinks(page), expectedLinks({ url, title, hasPicture: true }))
  await page.keyboard.press('Escape')

  await page.goto(`/Lars/${id}`)
  await enhancersReady(page)
  const card = await page.locator('.thread-main a[aria-label=Share]').getAttribute('href')
  assert.match(card ?? '', /^\/og\/.+\.jpg$/)
  await page.click('.thread-main a[aria-label=Share]')
  await page.locator('dialog.share[open]').waitFor()
  const links = await dialogLinks(page)
  assert.deepEqual(
    links,
    expectedLinks({ url, title, hasPicture: true, media: `${origin}${card}` }),
  )
  const pin = new URL(links.find(([id]) => id === 'pinterest')![1])
  assert.equal(pin.searchParams.get('media'), `${origin}${card}`)
  assert.deepEqual(problems, [])
})

test('cards added later (a posted blurt, the next page) share too', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await enhancersReady(page)
  await page.fill('form[action="/api/blurts"] textarea[name=text]', 'Posted just now')
  await page.click('form[action="/api/blurts"] button[type=submit]')
  const link = shareLink(page, 'Posted just now')
  await link.waitFor()
  await page.waitForFunction(() =>
    document
      .querySelector('article.blurt a[aria-label=Share]')
      ?.getAttribute('data-enhanced')
      ?.includes('share'),
  )
  await link.click()
  await page.locator('dialog.share[open]').waitFor()
  const id = await blurtIdByText('Posted just now')
  assert.equal(await page.inputValue('#share-link'), `${origin}/Lars/${id}`)
  await page.keyboard.press('Escape')

  // The next page of the feed, loaded by scrolling (more.ts).
  await insertBlurts(120)
  await page.reload()
  await enhancersReady(page)
  const first = await blurtIdByText('blurt 1')
  const path = `/Lars/${first}`
  const later = page.locator(`a[data-share-url="${path}"]`)
  for (let i = 0; i < 50 && (await later.count()) === 0; i++) {
    await page.mouse.wheel(0, 20000)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await page.waitForFunction(
    (path) =>
      document.querySelector(`a[data-share-url="${path}"]`)?.getAttribute('data-enhanced') ===
      'share',
    path,
  )
  await later.click()
  await page.locator('dialog.share[open]').waitFor()
  assert.equal(await page.inputValue('#share-link'), `${origin}/Lars/${first}`)
  assert.deepEqual(problems, [])
})

bothModes('Share on a profile', async ({ page }, javaScriptEnabled) => {
  await addAda([text], 'Counting things since 1843.')
  await page.goto('/Ada/')
  await enhancersReady(page)
  const link = page.locator('.profile-actions a, a.button', { hasText: 'Share' }).first()
  const href = await link.getAttribute('href')
  assert.match(href ?? '', /^\/og\/.+\.png$/)
  if (!javaScriptEnabled) {
    const response = await page.request.get(href!)
    assert.equal(response.headers()['content-type'], 'image/png')
    return
  }
  await link.click()
  await page.locator('dialog.share[open]').waitFor()
  const title = 'Ada on blurt.trade'
  assert.equal(await page.inputValue('#share-link'), `${origin}/Ada/`)
  assert.deepEqual(
    await dialogLinks(page),
    expectedLinks({ url: `${origin}/Ada/`, title, hasPicture: false }),
  )
})

test('the popup fits a narrow screen', async (t) => {
  const { page, problems } = await openTab(t, true, { viewport: { width: 360, height: 640 } })
  await addAda()
  await page.goto('/everyone')
  await enhancersReady(page)
  await shareLink(page, text).click()
  const dialog = page.locator('dialog.share[open]')
  await dialog.waitFor()
  const box = (await dialog.boundingBox())!
  assert.ok(box.x >= 0 && box.x + box.width <= 360, `${box.x} + ${box.width}`)
  assert.ok(box.y >= 0 && box.y + box.height <= 640, `${box.y} + ${box.height}`)
  assert.ok(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    'nothing in it is wider than the popup',
  )
  assert.deepEqual(problems, [])
})
