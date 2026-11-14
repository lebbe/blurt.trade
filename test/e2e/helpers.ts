import test from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
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
export async function openTab(
  t: { after: (fn: () => Promise<void>) => void },
  javaScriptEnabled: boolean,
): Promise<Tab> {
  assert.ok(browser, 'the browser is running')
  // Reduced motion turns the cross-document view transitions off (public/style.css):
  // during one the old page's snapshot takes the clicks, and with scripting disabled
  // Chromium was seen holding it for about a second, which makes clicks flaky.
  const context = await browser.newContext({
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
