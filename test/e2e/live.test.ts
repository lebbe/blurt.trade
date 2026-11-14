import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { db } from '../../src/db.ts'
import { streamCount } from '../../src/events.ts'
import { pushesSettled, setTestPushOrigins } from '../../src/push.ts'
import { generateVapidKeys } from '../../src/vapid.ts'
import { blurtIdByText, createSession, request } from '../helpers.ts'
import { baseUrl, enhancersReady, markWindow, openTab, samePage, signUp } from './helpers.ts'

// Live updates (src/client/live.ts, new-blurts.ts) and push notifications on a device
// (src/client/push.ts, sw.ts) in Chromium. Other users act through the API meanwhile.

async function cookieHeader(context: BrowserContext): Promise<string> {
  return (await context.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

async function userId(username: string): Promise<number> {
  const { rows } = await db().query('SELECT id FROM users WHERE username = $1', [username])
  return rows[0].id
}

async function liveOpen(page: Page): Promise<void> {
  await page.waitForSelector('html[data-live=open]')
}

const alerts = 'nav.top-nav a[href="/Lars/notifications/"]'
const corner = 'aside a[href="/Lars/notifications/"]'

test('the unread count updates live in the navigation and Your corner', async (t) => {
  const { page, context, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  const lars = await cookieHeader(context)
  const ada = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  const id = await blurtIdByText('first')
  await page.goto('/')
  await liveOpen(page)
  await markWindow(page)
  assert.equal(await page.locator(alerts).count(), 0)
  assert.equal((await page.textContent(corner))?.trim(), 'Notifications')

  await request('POST', '/api/blurts', `text=a reply&parentId=${id}`, { cookie: ada })
  await page.waitForSelector(`${alerts} .badge`)
  assert.equal(await page.textContent(`${alerts} .badge`), '1')
  assert.equal(await page.textContent(`${alerts} .visually-hidden`), '1 unread')
  assert.match((await page.textContent(corner)) ?? '', /^Notifications 11 unread$/)
  // Where the server would put it: before Settings.
  const order = await page.$$eval('nav.top-nav > a', (links) =>
    links.map((link) => link.getAttribute('href')),
  )
  assert.equal(order[order.indexOf('/Lars/notifications/') + 1], '/settings')

  await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
  await page.waitForFunction(
    (selector) => document.querySelector(`${selector} .badge`)?.textContent === '2',
    alerts,
  )

  // Read elsewhere: the link goes, as the server would render it.
  await request('POST', '/api/notifications/read', '', { cookie: lars })
  await page.waitForSelector(alerts, { state: 'detached' })
  assert.equal((await page.textContent(corner))?.trim(), 'Notifications')
  const context0 = JSON.parse((await page.textContent('#page-context')) ?? '{}')
  assert.equal(context0.unreadNotifications, 0)
  assert.ok(await samePage(page))
  assert.deepEqual(problems, [])
})

test('new blurts from others show as a banner, and go into the feed only when clicked', async (t) => {
  const { page, context, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  const lars = await cookieHeader(context)
  const ada = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=older one', { cookie: ada })
  await page.goto('/')
  await enhancersReady(page)
  await liveOpen(page)
  await markWindow(page)
  const banner = 'section[data-feed] > .new-blurts > button'
  assert.ok(await page.isHidden(banner))

  await request('POST', '/api/blurts', 'text=news from ada', { cookie: ada })
  await request('POST', '/api/blurts', 'text=more news', { cookie: ada })
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent === '2 new blurts',
    banner,
  )
  // Nothing moved by itself.
  assert.equal(await page.locator('article', { hasText: 'news from ada' }).count(), 0)
  // The viewer's own blurts are no news to them.
  await request('POST', '/api/blurts', 'text=my own', { cookie: lars })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal(await page.textContent(banner), '2 new blurts')

  await page.click(banner)
  await page.waitForSelector('section[data-feed] > article:has-text("more news")')
  const texts = await page.$$eval('section[data-feed] > article .blurt-body > p', (ps) =>
    ps.map((p) => p.textContent),
  )
  assert.deepEqual(texts.slice(0, 4), ['my own', 'more news', 'news from ada', 'older one'])
  assert.ok(await page.isHidden(banner))
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.closest('article')?.textContent?.includes('my own'),
    ),
    true,
  )
  // The new cards work like the others (enhanced: Like without a page load).
  await page.waitForSelector('section[data-feed] > article[data-enhanced~="blurt-actions"]')
  assert.ok(await samePage(page))
  assert.deepEqual(problems, [])
})

test('without JavaScript there is no live stream, and the count shows on the next page', async (t) => {
  const { page, context, problems } = await openTab(t, false)
  const asked: string[] = []
  page.on('request', (req) => asked.push(new URL(req.url()).pathname))
  await signUp(page, 'Lars')
  const lars = await cookieHeader(context)
  const ada = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  await page.goto('/')
  await request('POST', '/api/blurts', `text=a reply&parentId=${await blurtIdByText('first')}`, {
    cookie: ada,
  })
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(await page.locator(alerts).count(), 0)
  await page.reload()
  assert.equal(await page.textContent(`${alerts} .badge`), '1')
  assert.ok(!asked.includes('/api/events'))
  assert.equal(await page.locator('.new-blurts').count(), 0)
  assert.deepEqual(problems, [])
})

test('the stream closes when the page is left and opens again when it comes back', async (t) => {
  const { page, context, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  const lars = await cookieHeader(context)
  const larsId = await userId('Lars')
  const ada = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  await page.goto('/')
  await liveOpen(page)
  await page.goto('/people')
  await liveOpen(page)
  // The first page's stream was closed: one stream, the new page's.
  for (let i = 0; i < 50 && streamCount(larsId) !== 1; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(streamCount(larsId), 1)
  await page.goBack()
  await liveOpen(page)
  await request('POST', '/api/blurts', `text=a reply&parentId=${await blurtIdByText('first')}`, {
    cookie: ada,
  })
  await page.waitForSelector(`${alerts} .badge`)
  assert.deepEqual(problems, [])
})

test('Notify me on this device: permission on click, the worker shows what is unread', async (t) => {
  const keys = generateVapidKeys()
  process.env.VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey
  t.after(() => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
  })
  // A fake push service: pushes are recorded, never sent anywhere real.
  const pushes: string[] = []
  const service = http.createServer((req, res) => {
    pushes.push(req.url ?? '')
    req.resume().on('end', () => res.writeHead(201).end())
  })
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve))
  const serviceOrigin = `http://127.0.0.1:${(service.address() as AddressInfo).port}`
  setTestPushOrigins([serviceOrigin])
  t.after(() => {
    setTestPushOrigins([])
    service.close()
  })

  // Notifications need full Chromium (in its new headless mode): the headless shell the
  // other tests use denies the permission whatever is granted.
  const browser = await chromium.launch({ channel: 'chromium' })
  t.after(() => browser.close())
  const context = await browser.newContext({ baseURL: baseUrl, reducedMotion: 'reduce' })
  await context.grantPermissions(['notifications'], { origin: baseUrl })
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console: ${message.text()}`)
    }
  })
  // Headless Chromium has no push service of its own: subscribing is stubbed to hand out a
  // subscription at the fake one. Everything else (the worker, the permission, the
  // server) is real. Counts permission requests, which must wait for the click.
  await context.addInitScript((endpoint: string) => {
    const state = window as unknown as { permissionAsked: number; subscribed: boolean }
    state.permissionAsked = 0
    state.subscribed = sessionStorage.getItem('subscribed') === '1'
    const ask = Notification.requestPermission.bind(Notification)
    Notification.requestPermission = () => {
      state.permissionAsked++
      return ask()
    }
    const fake = {
      endpoint,
      expirationTime: null,
      toJSON: () => ({
        endpoint,
        expirationTime: null,
        keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) },
      }),
      unsubscribe: async () => {
        state.subscribed = false
        sessionStorage.removeItem('subscribed')
        return true
      },
    }
    PushManager.prototype.subscribe = async function () {
      state.subscribed = true
      sessionStorage.setItem('subscribed', '1')
      return fake as unknown as PushSubscription
    }
    PushManager.prototype.getSubscription = async function () {
      return (state.subscribed ? fake : null) as unknown as PushSubscription
    }
  }, `${serviceOrigin}/device/lars`)

  await signUp(page, 'Lars')
  const lars = await cookieHeader(context)
  const ada = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  const id = await blurtIdByText('first')
  await page.goto('/Lars/edit#notifications')
  await enhancersReady(page)
  const button = '.push-device button'
  assert.equal(await page.textContent(button), 'Notify me on this device')
  assert.equal(
    await page.evaluate(() => (window as unknown as { permissionAsked: number }).permissionAsked),
    0,
  )

  await page.click(button)
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent === 'Stop notifying this device',
    button,
  )
  assert.equal(
    await page.evaluate(() => (window as unknown as { permissionAsked: number }).permissionAsked),
    1,
  )
  const scriptUrl = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return registration.active?.scriptURL
  })
  assert.equal(scriptUrl, `${baseUrl}/sw.js`)
  const { rows } = await db().query('SELECT endpoint FROM push_subscriptions')
  assert.deepEqual(rows, [{ endpoint: `${serviceOrigin}/device/lars` }])

  // A reply pushes (empty) to the device's push service...
  await request('POST', '/api/blurts', `text=hello there&parentId=${id}`, { cookie: ada })
  await pushesSettled()
  assert.deepEqual(pushes, ['/device/lars'])

  // ...which wakes the worker; here the push is handed to it by DevTools instead.
  const cdp = await context.newCDPSession(page)
  const registrationId = new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const ours = registrations.find((r: { scopeURL: string }) => r.scopeURL === `${baseUrl}/`)
      if (ours) {
        resolve(ours.registrationId)
      }
    })
  })
  await cdp.send('ServiceWorker.enable')
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: baseUrl,
    registrationId: await registrationId,
    data: '',
  })
  const shown = async () =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      return (await registration.getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        url: (n.data as { url?: string } | null)?.url,
      }))
    })
  let notifications = await shown()
  for (let i = 0; i < 100 && notifications.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    notifications = await shown()
  }
  assert.deepEqual(notifications, [
    {
      title: 'Ada replied to your blurt',
      body: 'hello there',
      tag: 'notifications',
      url: `/Ada/${await blurtIdByText('hello there')}`,
    },
  ])

  // A second one: one notification for both, replacing the first.
  await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: baseUrl,
    registrationId: await registrationId,
    data: '',
  })
  for (let i = 0; i < 100 && notifications[0]?.title !== '2 new notifications'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    notifications = await shown()
  }
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].title, '2 new notifications')
  assert.equal(notifications[0].url, '/notifications/')

  // Off again: the server forgets it, and the worker is gone.
  await page.click(button)
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent === 'Notify me on this device',
    button,
  )
  assert.equal((await db().query('SELECT 1 FROM push_subscriptions')).rowCount, 0)
  assert.equal(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration('/')) === undefined,
    ),
    true,
  )
  assert.deepEqual(problems, [])
})

test('the push button is not shown without JavaScript, nor without VAPID keys', async (t) => {
  const keys = generateVapidKeys()
  process.env.VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey
  t.after(() => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
  })
  const { page, problems } = await openTab(t, false)
  await signUp(page, 'Lars')
  await page.goto('/Lars/edit')
  assert.ok(await page.isHidden('.push-device'))
  assert.equal(await page.locator('.push-device button').isVisible(), false)
  delete process.env.VAPID_PUBLIC_KEY
  await page.reload()
  assert.equal(await page.locator('.push-device').count(), 0)
  assert.deepEqual(problems, [])
})
