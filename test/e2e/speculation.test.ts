import test from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { collectLogs } from '../helpers.ts'
import { baseUrl, enhancersReady, markWindow, openTab, samePage, signUp } from './helpers.ts'

// Speculation Rules prefetches (src/speculation.ts) in the real Chromium: a write sent with
// fetch() keeps the page, and with it what it prefetched, so its answer clears them.

test('a write without a page load drops the pages prefetched before it', async (t) => {
  const logs = collectLogs(t)
  const { page, context, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  const cookies = (await context.cookies()).map((cookie) => cookie.name).toSorted()
  await page.goto('/')
  await enhancersReady(page)
  await markWindow(page)
  // Requests for the profile page reaching the server, prefetches included.
  const profileLoads = () =>
    logs.filter((line) => line.method === 'GET' && line.path === '/Lars/').length
  const link = page.locator('a[href="/Lars/"]').first()
  await prefetch(page, link, profileLoads, 1)

  await page.fill('form[action="/api/blurts"] textarea[name=text]', 'Fresh blurt')
  await page.click('form[action="/api/blurts"] button[type=submit]')
  await page.locator('article.blurt', { hasText: 'Fresh blurt' }).waitFor()
  assert.ok(await samePage(page), 'posted in place')

  await link.click()
  await page.waitForURL(`${baseUrl}/Lars/`)
  assert.equal(profileLoads(), 2, 'the prefetch from before the blurt was not used')
  await page.locator('article.blurt', { hasText: 'Fresh blurt' }).waitFor()
  // Only the prefetches went: still logged in, with the same cookies.
  assert.deepEqual((await context.cookies()).map((cookie) => cookie.name).toSorted(), cookies)
  assert.equal(await page.locator('form[action="/api/logout"]').count(), 1)

  // And prefetching goes on as before.
  await page.goto('/')
  await prefetch(page, page.locator('a[href="/Lars/"]').first(), profileLoads, 3)
  await page.locator('a[href="/Lars/"]').first().click()
  await page.waitForURL(`${baseUrl}/Lars/`)
  assert.equal(profileLoads(), 3, 'a prefetch with no write since is used')
  assert.deepEqual(problems, [])
})

// Hovers `link` until the server has had `count` requests for it.
async function prefetch(
  page: Page,
  link: ReturnType<Page['locator']>,
  loads: () => number,
  count: number,
): Promise<void> {
  await link.hover()
  for (let i = 0; i < 200 && loads() < count; i++) {
    await page.waitForTimeout(20)
  }
  assert.equal(loads(), count, 'prefetched on hover')
  await page.mouse.move(0, 0)
}
