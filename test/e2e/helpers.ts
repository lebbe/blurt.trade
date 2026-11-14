import test from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright'
import { app } from '../../src/server.ts'
// The test database, migrated once and emptied before each test, as for the other tests.
import '../helpers.ts'

// Browser tests: the app on a random port, driven by Chromium through Playwright. Each
// flow runs twice, with the browser's JavaScript off and on, since everything must work
// without it (docs/routes.md, JavaScript in the browser). Run with `npm run e2e`.

let server: Server | undefined
let browser: Browser | undefined
export let baseUrl = ''

test.before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server?.once('listening', resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  browser = await chromium.launch()
})

test.after(async () => {
  await browser?.close()
  await new Promise((resolve) => server?.close(resolve))
})

// What went wrong on a page: uncaught errors, console errors and failed requests.
export type Problems = string[]

export type Tab = { page: Page; context: BrowserContext; problems: Problems; requests: string[] }

// A new browser profile (no cookies) with its JavaScript on or off, and one page in it.
// `options` for more of the profile: a phone's touch screen, permissions.
export async function openTab(
  t: { after: (fn: () => Promise<void>) => void },
  javaScriptEnabled: boolean,
  options: BrowserContextOptions = {},
): Promise<Tab> {
  assert.ok(browser, 'the browser is running')
  // Reduced motion turns the cross-document view transitions off (public/style.css):
  // during one the old page's snapshot takes the clicks, and with scripting disabled
  // Chromium was seen holding it for about a second, which makes clicks flaky.
  const context = await browser.newContext({
    ...options,
    baseURL: baseUrl,
    javaScriptEnabled,
    reducedMotion: 'reduce',
  })
  t.after(() => context.close())
  const page = await context.newPage()
  const problems: Problems = []
  // Requests that got an answer. With the browser's JavaScript off, Chromium still sees
  // the <link rel="modulepreload"> and <script> elements but blocks their fetches (they
  // fail with "csp"), so those are neither problems nor loaded.
  const requests: string[] = []
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console: ${message.text()}`)
    }
  })
  page.on('requestfinished', (request) => requests.push(new URL(request.url()).pathname))
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText
    if (!(error === 'csp' && !javaScriptEnabled)) {
      problems.push(`failed: ${request.url()} ${error}`)
    }
  })
  return { page, context, problems, requests }
}

// Whether main.ts ran on the page (it sets <html data-js="on">).
export async function scriptRan(page: Page): Promise<boolean> {
  return (await page.getAttribute('html', 'data-js')) === 'on'
}

// With JavaScript on, waits until every enhancer on the page is ready (a click before that
// is an ordinary form or link, as it should be, but not what a test of the enhancer tests).
export async function enhancersReady(page: Page): Promise<void> {
  if (await scriptRan(page)) {
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLElement>('[data-enhance]')].every(
        (element) => element.dataset.enhanced === element.dataset.enhance,
      ),
    )
  }
}

// A mark on the window: it survives anything but a page load.
export async function markWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { stillHere: boolean }).stillHere = true
  })
}

export async function samePage(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere === true)
}

export async function signUp(page: Page, username: string): Promise<void> {
  await page.goto('/signup')
  await page.fill('input[name=username]', username)
  await page.fill('input[name=password]', 'correct-horse')
  await page.fill('input[name=passwordConfirm]', 'correct-horse')
  await page.click('form[action="/signup"] button[type=submit]')
  await page.waitForURL(`${baseUrl}/`)
}

// Both modes, as two tests with the mode in the name.
export function bothModes(
  name: string,
  flow: (tab: Tab, javaScriptEnabled: boolean) => Promise<void>,
): void {
  for (const javaScriptEnabled of [false, true]) {
    test(`${name} (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async (t) => {
      const tab = await openTab(t, javaScriptEnabled)
      await flow(tab, javaScriptEnabled)
      assert.deepEqual(tab.problems, [])
    })
  }
}

// Holds every request to `path` until release() (then it goes on to the server), so a test
// can see what the page does before the answer comes. `answer` instead gives that status
// with an error body, as a failed save.
export async function holdRequests(
  page: Page,
  path: string,
  answer?: number,
): Promise<{
  release: () => void
  sent: () => number
  sentAtLeast: (count: number) => Promise<number>
}> {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let sent = 0
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      sent++
      await released
      if (answer) {
        await route.fulfill({
          status: answer,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Something broke' }),
        })
      } else {
        await route.continue()
      }
    },
  )
  // The status line can say "Saving…" a moment before the request reaches the route.
  const sentAtLeast = async (count: number) => {
    for (let i = 0; i < 100 && sent < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return sent
  }
  return { release, sent: () => sent, sentAtLeast }
}
