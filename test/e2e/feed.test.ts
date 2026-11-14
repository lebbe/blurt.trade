import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { clientModuleUrl } from '../../src/client-modules.ts'
import { db } from '../../src/db.ts'
import { randomAvatar } from '../../src/avatar.ts'
import { deleteBlurts } from '../../src/routes/state/blurts.ts'
import { blurtIdByText, insertBlurts, samplePng } from '../helpers.ts'
import {
  baseUrl,
  bothModes,
  enhancersReady,
  holdRequests,
  markWindow,
  openTab,
  samePage,
  signUp,
} from './helpers.ts'

// The pages people read blurts on (src/client/composer.ts, more.ts, blurt-actions.ts,
// follow.ts): with JavaScript, posting, liking, reblurting, following, deleting, reporting
// and scrolling to older blurts happen without a page load, rendered with the same
// components as the server's pages. Without it, the same forms and links as before.

const composer = 'form[action="/api/blurts"]'

function card(page: Page, text: string) {
  return page.locator('article.blurt', { hasText: text }).first()
}

// What the live region (src/client/announce.ts) says once it says it.
async function announced(page: Page, message: string | RegExp): Promise<void> {
  await page.waitForFunction(
    ({ source, flags }) =>
      new RegExp(source, flags).test(document.querySelector('[data-announcer]')?.textContent ?? ''),
    typeof message === 'string'
      ? { source: `^${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, flags: '' }
      : { source: message.source, flags: message.flags },
  )
}

// A second account, with a profile, and blurts by it, straight in the database.
async function addUser(username: string, texts: string[] = []): Promise<void> {
  await db().query(
    `WITH u AS (INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id),
       p AS (INSERT INTO user_profiles (user_id, avatar) SELECT id, $2::jsonb FROM u)
     INSERT INTO blurts (user_id, text) SELECT u.id, t FROM u, unnest($3::text[]) AS t`,
    [username, JSON.stringify(randomAvatar()), texts],
  )
}

// The items of a list, rendered in the browser from the page's JSON with the shared
// components (ListItem, src/ui/lists.ts), next to the same items as the server rendered
// them in its HTML for that URL: they must be the same nodes.
async function compareWithServer(
  page: Page,
  path: string,
  kind: string,
  selector: string,
): Promise<{ count: number; different: { item: number; clientVsServer: string }[] }> {
  return page.evaluate(
    async ({ path, kind, selector, urls }) => {
      const { ListItem, listKeys } = await import(urls.lists)
      const { renderNodes } = await import(urls.render)
      const { withDates } = await import(urls.json)
      const { readPageContext } = await import(urls.context)
      const { html } = await import(urls.html)
      const context = readPageContext()
      const url = new URL(path, location.href)
      const htmlText = await (await fetch(url)).text()
      url.searchParams.set('pictures', 'none')
      const data = await (await fetch(url, { headers: { Accept: 'application/json' } })).json()
      const server = [
        ...new DOMParser().parseFromString(htmlText, 'text/html').querySelectorAll(selector),
      ]
      const client = (withDates(data[listKeys[kind]]) as unknown[])
        .flatMap((item) =>
          renderNodes(
            html`<${ListItem} kind=${kind} item=${item} viewer=${context.viewer} />`,
            context,
          ),
        )
        .filter((node: Node): node is Element => node instanceof Element)
      // Compared as markup (outerHTML), not with isEqualNode: an SVG's xmlns attribute is in
      // the XMLNS namespace when parsed and in none when Preact sets it, which is the same
      // markup. The first place two trees differ: the two nodes there, shallow.
      const describe = (node: Node | undefined) =>
        !node
          ? '(none)'
          : node instanceof Element
            ? `<${node.localName}${[...node.attributes].map((a) => ` ${a.name}="${a.value}"`).join('')}>`
            : JSON.stringify(node.textContent)
      const firstDifference = (a: Node, b: Node): string | null => {
        const shallow = (node: Node) => describe(node.cloneNode(false))
        if (a.nodeType !== b.nodeType || shallow(a) !== shallow(b)) {
          return `${shallow(a)} | ${shallow(b)}`
        }
        const length = Math.max(a.childNodes.length, b.childNodes.length)
        for (let i = 0; i < length; i++) {
          const [x, y] = [a.childNodes[i], b.childNodes[i]]
          if (!x || !y) {
            return `${describe(x)} | ${describe(y)}`
          }
          const found = firstDifference(x, y)
          if (found) {
            return found
          }
        }
        return null
      }
      const different = []
      for (let i = 0; i < Math.max(client.length, server.length); i++) {
        const found =
          client[i] && server[i]
            ? client[i].outerHTML === server[i].outerHTML
              ? null
              : (firstDifference(client[i], server[i]) ?? 'attribute order')
            : `${describe(client[i])} | ${describe(server[i])}`
        if (found) {
          different.push({ item: i, clientVsServer: found })
        }
      }
      return { count: client.length, different: different.slice(0, 2) }
    },
    {
      path,
      kind,
      selector,
      urls: {
        lists: clientModuleUrl('ui/lists.ts'),
        render: clientModuleUrl('client/render.ts'),
        json: clientModuleUrl('client/json.ts'),
        context: clientModuleUrl('client/page-context.ts'),
        html: clientModuleUrl('ui/html.ts'),
      },
    },
  )
}

bothModes('a blurt goes into the feed', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await addUser('Ada', ['Older, by Ada'])
  await page.goto('/')
  await enhancersReady(page)
  await markWindow(page)

  await page.fill(`${composer} textarea[name=text]`, 'Straight into the feed')
  await page.click(`${composer} button[type=submit]`)
  const posted = card(page, 'Straight into the feed')
  await posted.waitFor()
  // On top of the list, above the older blurt.
  assert.match(
    (await page.locator('section[data-new-blurts] > article.blurt').first().textContent()) ?? '',
    /Straight into the feed/,
  )
  assert.equal(await page.inputValue(`${composer} textarea[name=text]`), '')
  assert.equal(await samePage(page), javaScriptEnabled, 'no page load with JavaScript')
  if (javaScriptEnabled) {
    assert.ok(await posted.evaluate((element) => element === document.activeElement))
    await announced(page, 'Your blurt is posted.')
    // Its buttons work too: it was enhanced like the server's cards.
    await posted.locator('form[action="/api/like"] button').click()
    await posted.locator('form[action="/api/unlike"]').waitFor()
    assert.ok(await samePage(page))
  }
  // And it is the blurt the server shows after a reload.
  await page.reload()
  await card(page, 'Straight into the feed').waitFor()
})

test('the composer counts characters, sends on Ctrl+Enter and shows errors', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await enhancersReady(page)
  await markWindow(page)
  const hint = page.locator(`${composer} .composer-hint`)
  assert.equal(await hint.textContent(), '280 characters left · public')
  await page.fill(`${composer} textarea[name=text]`, '🙂 hi')
  assert.equal(await hint.textContent(), '276 characters left · public')
  await page.fill(`${composer} textarea[name=text]`, 'x'.repeat(270))
  assert.equal(await hint.getAttribute('data-state'), 'low')
  assert.equal(
    await page.getAttribute(`${composer} textarea[name=text]`, 'aria-describedby'),
    await hint.getAttribute('id'),
  )

  // Too many line breaks: the server says no, and the form shows it.
  await page.fill(`${composer} textarea[name=text]`, 'a\nb\nc\nd\ne\nf\ng')
  assert.match((await hint.textContent()) ?? '', /at most 5 line breaks/)
  await page.press(`${composer} textarea[name=text]`, 'Control+Enter')
  const error = page.locator(`${composer} .validation-error[role=alert]`)
  await error.waitFor()
  assert.equal(await error.textContent(), 'Blurt can have at most 5 newlines')
  assert.equal(await page.inputValue(`${composer} textarea[name=text]`), 'a\nb\nc\nd\ne\nf\ng')

  await page.fill(`${composer} textarea[name=text]`, 'Sent with the keyboard')
  await page.press(`${composer} textarea[name=text]`, 'Control+Enter')
  await card(page, 'Sent with the keyboard').waitFor()
  assert.equal(await error.count(), 0)
  assert.ok(await samePage(page))
  assert.deepEqual(
    problems.filter((problem) => !/status of 400/.test(problem)),
    [],
  )
})

bothModes('a blurt with a picture', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await page.goto('/')
  await enhancersReady(page)
  const file = join(tmpdir(), `blurt-picture-${process.pid}.png`)
  writeFileSync(file, samplePng(400, 200))
  await page.setInputFiles(`${composer} input[name=picture]`, file)
  await page.fill(`${composer} textarea[name=text]`, 'With a picture')
  if (javaScriptEnabled) {
    // The drawing, made in the browser, from a blob: URL the scripting CSP allows
    // (more in test/e2e/picture.test.ts).
    const preview = page.locator(`${composer} .picture-preview img:not([hidden])`)
    await preview.waitFor()
    assert.match((await preview.getAttribute('src')) ?? '', /^blob:/)
    await page.waitForFunction(
      () =>
        (document.querySelector<HTMLImageElement>('.picture-preview img')?.naturalWidth ?? 0) > 0,
    )
    // While the server draws it, the form says so.
    const held = await holdRequests(page, '/api/blurts')
    await page.click(`${composer} button[type=submit]`)
    await page.locator(`${composer} .composer-status:has-text("Drawing your picture…")`).waitFor()
    assert.ok(await page.locator(`${composer} button[type=submit]`).isDisabled())
    held.release()
  } else {
    await page.click(`${composer} button[type=submit]`)
  }
  const picture = card(page, 'With a picture').locator('img.blurt-picture')
  await picture.waitFor()
  const id = await blurtIdByText('With a picture')
  assert.equal(await picture.getAttribute('src'), `/pictures/${id}.svg`)
  await page.waitForFunction(
    () => (document.querySelector<HTMLImageElement>('img.blurt-picture')?.naturalWidth ?? 0) > 0,
  )
  if (javaScriptEnabled) {
    assert.equal(await page.locator(`${composer} .picture-preview`).count(), 0)
    assert.equal(await page.inputValue(`${composer} input[name=picture]`), '')
    assert.equal(await page.locator(`${composer} .composer-status`).textContent(), '')
  }
})

bothModes('a reply goes to the end of the thread', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await addUser('Ada', ['A thread by Ada'])
  const id = await blurtIdByText('A thread by Ada')
  await db().query(
    `INSERT INTO blurts (user_id, text, parent_id, created_at)
     SELECT id, 'First reply', $1, now() - interval '1 minute' FROM users WHERE username = 'Ada'`,
    [id],
  )
  await page.goto(`/Ada/${id}`)
  await enhancersReady(page)
  await markWindow(page)
  const reply = 'form[action="/api/blurts"]:has(input[name=parentId])'
  await page.fill(`${reply} textarea[name=text]`, 'My reply')
  await page.click(`${reply} button[type=submit]`)
  await page.locator('.thread-children > article.blurt', { hasText: 'My reply' }).waitFor()
  const texts = await page
    .locator('.thread-children > article.blurt .blurt-body > p')
    .allTextContents()
  assert.deepEqual(texts, ['First reply', 'My reply'])
  assert.equal(await samePage(page), javaScriptEnabled)
  if (javaScriptEnabled) {
    await announced(page, 'Your reply is posted.')
    // As the server renders replies in a thread: no "Replying to".
    assert.equal(
      await page
        .locator('.thread-children > article.blurt', { hasText: 'My reply' })
        .locator('.replying-to')
        .count(),
      0,
    )
  }
})

// 450 blurts: the first page, three more loaded by scrolling, then a click for the rest.
test('older blurts load as the list scrolls, three pages at a time', async (t) => {
  const { page, problems, requests } = await openTab(t, true)
  await signUp(page, 'Lars')
  await insertBlurts(450)
  const requestsBefore = requests.filter((path) => path === '/').length + 1
  await page.goto('/')
  await enhancersReady(page)
  await markWindow(page)
  const cards = page.locator('section[data-new-blurts] > article.blurt')
  assert.equal(await cards.count(), 100)
  const link = page.locator('.next-page a[rel=next]')
  const first = await link.getAttribute('href')
  assert.match(first ?? '', /^\/\?before=/)

  // Three pages by scrolling, each announced.
  for (const count of [200, 300, 400]) {
    await link.scrollIntoViewIfNeeded()
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('section[data-new-blurts] > article.blurt').length === count,
      count,
    )
    await announced(page, '100 older blurts loaded')
  }
  assert.equal(await page.getAttribute('section[data-new-blurts]', 'aria-busy'), null)
  // Then it stops, so the footer can be reached.
  await page.locator('footer').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  assert.equal(await cards.count(), 400)
  assert.equal(requests.filter((path) => path === '/').length - requestsBefore, 3)
  assert.ok(await page.locator('footer a[href="/about"]').isVisible())

  // The address bar follows the page being read.
  await page
    .locator('article.blurt', { hasText: /blurt 151(?!\d)/ })
    .first()
    .scrollIntoViewIfNeeded()
  await page.evaluate(() => scrollBy(0, 0))
  await page.waitForFunction(() => location.search.startsWith('?before='))
  const readingAt = await page.evaluate(() => location.pathname + location.search)
  assert.notEqual(readingAt, first)

  // A click loads the last 50 in place, moves the focus to the first of them, and the
  // link goes: there is nothing older.
  await link.click()
  await page.waitForFunction(
    () => document.querySelectorAll('section[data-new-blurts] > article.blurt').length === 450,
  )
  await announced(page, '50 older blurts loaded')
  assert.equal(await link.count(), 0)
  assert.match(
    (await page.evaluate(() => document.activeElement?.textContent)) ?? '',
    /blurt 50(?!\d)/,
  )
  assert.ok(await samePage(page))
  // Newest first, with nothing twice and nothing missing across the pages.
  const texts = await page
    .locator('section[data-new-blurts] > article.blurt .blurt-body > p')
    .allTextContents()
  assert.deepEqual(
    texts,
    Array.from({ length: 450 }, (_, i) => `blurt ${450 - i}`),
  )

  // A reload starts where the address bar says, at the page being read.
  await page.goto(readingAt)
  const top = await page
    .locator('section[data-new-blurts] > article.blurt .blurt-body > p')
    .first()
    .textContent()
  assert.match(top ?? '', /^blurt (350|250|150)$/)
  assert.deepEqual(problems, [])
})

test('Back to a scrolled feed keeps the place', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await insertBlurts(250)
  await page.goto('/')
  await enhancersReady(page)
  await page.locator('.next-page a[rel=next]').scrollIntoViewIfNeeded()
  await page.waitForFunction(
    () => document.querySelectorAll('section[data-new-blurts] > article.blurt').length === 200,
  )
  const target = page.locator('article.blurt', { hasText: /blurt 60(?!\d)/ }).first()
  await target.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => location.search.startsWith('?before='))
  await target.locator('.blurt-meta a[href^="/Lars/"]').last().click()
  await page.waitForURL(/\/Lars\/\d+$/)
  await page.goBack()
  // From the back/forward cache, everything loaded is still there; without it, the page
  // the address bar was at loads, which has the blurt being read.
  await page
    .locator('article.blurt', { hasText: /blurt 60(?!\d)/ })
    .first()
    .waitFor()
  assert.match(page.url(), /\/\?before=/)
  assert.deepEqual(problems, [])
})

test('without JavaScript, Older blurts is a link to the next page', async (t) => {
  const { page, problems } = await openTab(t, false)
  await signUp(page, 'Lars')
  await insertBlurts(150)
  await page.goto('/')
  await page.click('.next-page a[rel=next]')
  await page.waitForURL(/\/\?before=/)
  assert.equal(await page.locator('article.blurt').count(), 50)
  assert.deepEqual(problems, [])
})

test('the browser renders each list as the server does', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await page.goto('/Lars/edit')
  await enhancersReady(page)
  // Times in a zone and language of the viewer's own, so the formatting is compared too.
  await page.selectOption('form[action="/api/timezone"] select[name=timezone]', 'Europe/Oslo')
  await page.waitForFunction(() =>
    document.querySelector('form[action="/api/timezone"] [data-state=saved]'),
  )
  await addUser('Ada', ['Hello from **Ada** https://example.com #tag @Lars'])
  await insertBlurts(230)
  const adaBlurt = await blurtIdByText('Hello from **Ada** https://example.com #tag @Lars')
  // A thread with replies of both, a quote, a reblurt, likes and a deleted reply.
  await db().query(
    `INSERT INTO blurts (user_id, text, parent_id)
       SELECT u.id, 'reply ' || i, $1 FROM users u, generate_series(1, 120) i
       WHERE u.username = CASE WHEN i % 2 = 0 THEN 'Lars' ELSE 'Ada' END`,
    [adaBlurt],
  )
  await page.goto('/')
  await enhancersReady(page)
  // Lars quotes Ada's blurt, reblurts it, and blurts a picture, as the forms would.
  await page.evaluate(async (id) => {
    const canvas = new OffscreenCanvas(300, 200)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#d4001c'
    context.fillRect(50, 50, 200, 100)
    const picture = new FormData()
    picture.append('text', 'A picture')
    picture.append('picture', await canvas.convertToBlob({ type: 'image/png' }), 'red.png')
    for (const [path, body] of [
      ['/api/blurts', new URLSearchParams(`text=Quoting+it&reblurtOfId=${id}`)],
      ['/api/reblurt', new URLSearchParams(`blurtId=${id}`)],
      ['/api/blurts', picture],
    ] as const) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
      })
      if (!response.ok) {
        throw new Error(`${path}: ${response.status}`)
      }
    }
  }, adaBlurt)
  await page.reload()
  await enhancersReady(page)
  // Every kind of card is in a list being compared: the feed has the picture and the
  // quote, the profile the plain reblurt.
  for (const part of ['img.blurt-picture', 'blockquote.quoted']) {
    await page.locator(`section[data-new-blurts] > article.blurt ${part}`).first().waitFor()
  }
  assert.match(await (await page.request.get('/Lars/')).text(), /class="reblurted-by"/)
  for (const like of ['Hello from', 'blurt 230']) {
    await card(page, like).locator('form[action="/api/like"] button').click()
    await card(page, like).locator('form[action="/api/unlike"]').waitFor()
  }
  await deleteBlurts([await blurtIdByText('reply 3')])
  // Notifications about Ada's replies, half of them read.
  await db().query(
    `INSERT INTO notifications (user_id, kind, actor_user_id, blurt_id, read_at)
     SELECT lars.id, 'reply', ada.id, b.id, CASE WHEN b.id % 2 = 0 THEN now() END
     FROM users lars, users ada, blurts b
     WHERE lars.username = 'Lars' AND ada.username = 'Ada' AND b.user_id = ada.id
       AND b.parent_id IS NOT NULL AND b.deleted_at IS NULL`,
  )

  const feedJson = await page.evaluate(async () =>
    (await fetch('/everyone', { headers: { Accept: 'application/json' } })).json(),
  )
  const people = Array.from({ length: 60 }, (_, i) => `person${String(i).padStart(2, '0')}`)
  for (const name of people) {
    await addUser(name)
  }
  const cases: [path: string, kind: string, selector: string][] = [
    ['/Lars/notifications/', 'notifications', 'main article.notification'],
    ['/Lars/notifications/?read=1', 'notifications', 'main article.notification'],
    ['/everyone', 'feed', 'section[data-new-blurts] > article.blurt'],
    [`/everyone?before=${feedJson.next}`, 'feed', 'section[data-new-blurts] > article.blurt'],
    ['/Lars/', 'blurts', 'main section[aria-label="Lars blurts"] > article.blurt'],
    ['/search?q=blurt', 'blurts', 'main section[aria-label="Blurts"] > article.blurt'],
    [`/Ada/${adaBlurt}`, 'replies', '.thread-children > article.blurt'],
    ['/people', 'people', 'ul.people > li'],
  ]
  for (const [path, kind, selector] of cases) {
    const { count, different } = await compareWithServer(page, path, kind, selector)
    assert.ok(count > 0, `${path} has items`)
    assert.deepEqual(different, [], path)
  }
  assert.deepEqual(problems, [])
})

test('and for anonymous visitors, who get the cards without buttons', async (t) => {
  const { page, problems } = await openTab(t, true)
  await addUser('Ada', ['Hello from Ada'])
  await page.goto('/')
  await enhancersReady(page)
  assert.equal(await page.locator('article[data-enhance]').count(), 0)
  for (const [path, kind, selector] of [
    ['/', 'feed', 'section[data-new-blurts] > article.blurt'],
    ['/people', 'people', 'ul.people > li'],
  ]) {
    const { count, different } = await compareWithServer(page, path, kind, selector)
    assert.equal(count, 1, path)
    assert.deepEqual(different, [], path)
  }
  assert.deepEqual(problems, [])
})

bothModes('like and reblurt without a page load', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await addUser('Ada', ['Like me'])
  await page.goto('/')
  await enhancersReady(page)
  await markWindow(page)
  const blurt = () => card(page, 'Like me')

  if (javaScriptEnabled) {
    // At once, before the server answers.
    const held = await holdRequests(page, '/api/like')
    await blurt().locator('form[action="/api/like"] button').click()
    await blurt().locator('form[action="/api/unlike"] button[aria-pressed=true]').waitFor()
    assert.match(
      (await blurt().locator('form[action="/api/unlike"] .like-count').textContent()) ?? '',
      /^1 like/,
    )
    // The focus stays on the button.
    assert.ok(
      await page.evaluate(
        () => document.activeElement?.closest('form')?.getAttribute('action') === '/api/unlike',
      ),
    )
    held.release()
    await page.unroute((url) => url.pathname === '/api/like')
  } else {
    await blurt().locator('form[action="/api/like"] button').click()
  }
  await blurt().locator('form[action="/api/unlike"]').waitFor()
  await blurt().locator('form[action="/api/reblurt"] button').click()
  await blurt().locator('form[action="/api/unreblurt"]').waitFor()
  assert.match(
    (await blurt().locator('form[action="/api/unreblurt"] .like-count').textContent()) ?? '',
    /^1 reblurt/,
  )
  assert.equal(await samePage(page), javaScriptEnabled)

  await page.reload()
  await blurt().locator('form[action="/api/unlike"]').waitFor()
  await blurt().locator('form[action="/api/unreblurt"]').waitFor()
})

test('a refused like goes back and says why', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await addUser('Ada', ['Like me'])
  await page.goto('/')
  await enhancersReady(page)
  await markWindow(page)
  await page.route(
    (url) => url.pathname === '/api/like',
    (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Too many requests. Please wait 9 seconds' }),
      }),
  )
  await card(page, 'Like me').locator('form[action="/api/like"] button').click()
  await announced(page, 'Too many requests. Please wait 9 seconds')
  await card(page, 'Like me')
    .locator('form[action="/api/like"] button[aria-pressed=false]')
    .waitFor()
  assert.match(
    (await card(page, 'Like me').locator('.like-count').first().textContent()) ?? '',
    /^0 likes/,
  )
  assert.ok(await samePage(page))
  assert.deepEqual(
    problems.filter((problem) => !/status of 429/.test(problem)),
    [],
  )
})

bothModes('follow and unfollow on a profile', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await addUser('Ada')
  await page.goto('/Ada/')
  await enhancersReady(page)
  await markWindow(page)
  await page.click('form[action="/api/follow"] button')
  await page.locator('form[action="/api/unfollow"]').waitFor()
  await page.locator('.page-title .tagline:has-text("1 follower · 0 following")').waitFor()
  if (javaScriptEnabled) {
    await announced(page, 'You follow Ada.')
  }
  await page.click('form[action="/api/unfollow"] button')
  await page.locator('form[action="/api/follow"]').waitFor()
  await page.locator('.page-title .tagline:has-text("0 followers · 0 following")').waitFor()
  assert.equal(await samePage(page), javaScriptEnabled)
})

bothModes('delete asks first', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await addUser('Ada', ['Stays'])
  await page.goto('/')
  await page.fill(`${composer} textarea[name=text]`, 'Regret this')
  await page.click(`${composer} button[type=submit]`)
  await card(page, 'Regret this').waitFor()
  await page.goto('/')
  await enhancersReady(page)
  await markWindow(page)
  const summary = card(page, 'Regret this').locator('summary[aria-label=Delete]')
  await summary.click()
  if (javaScriptEnabled) {
    const dialog = page.locator('dialog.confirm[open]')
    await dialog.waitFor()
    assert.equal(await dialog.locator('p').textContent(), 'Delete this blurt for good?')
    // Cancel (and Escape) keeps it, and gives the focus back.
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.ok(await summary.evaluate((element) => element === document.activeElement))
    await summary.click()
    await page.click('dialog.confirm button:has-text("Delete")')
    await announced(page, 'Blurt deleted.')
    assert.ok(await samePage(page))
  } else {
    await card(page, 'Regret this').locator('details[open] button:has-text("Delete")').click()
    await page.waitForURL(`${baseUrl}/`)
  }
  await page.waitForFunction(() => !document.body.textContent?.includes('Regret this'))
  await card(page, 'Stays').waitFor()
  await page.reload()
  assert.equal(await page.locator('article.blurt', { hasText: 'Regret this' }).count(), 0)
})

bothModes('report a blurt', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await addUser('Ada', ['Report me'])
  await page.goto('/')
  await enhancersReady(page)
  await markWindow(page)
  await card(page, 'Report me').locator('summary[aria-label=Report]').click()
  await card(page, 'Report me').locator('input[name=reason]').fill('Rude')
  await card(page, 'Report me').locator('form[action="/api/report"] button').click()
  if (javaScriptEnabled) {
    await card(page, 'Report me').locator('text=You reported this blurt.').waitFor()
    await announced(page, 'Reported. Thank you.')
    assert.ok(await samePage(page))
  } else {
    await page.waitForURL(/\/Ada\/\d+$/)
    await page.locator('text=You reported this blurt.').waitFor()
  }
  const { rows } = await db().query('SELECT reason FROM reports')
  assert.deepEqual(rows, [{ reason: 'Rude' }])
})

test('More replies loads the rest of a thread in place', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await addUser('Ada', ['Busy thread'])
  const id = await blurtIdByText('Busy thread')
  await insertBlurts(130, id)
  await page.goto(`/Ada/${id}`)
  await enhancersReady(page)
  await markWindow(page)
  assert.equal(await page.locator('.thread-children > article.blurt').count(), 100)
  await page.locator('.next-page a[rel=next]').scrollIntoViewIfNeeded()
  await page.waitForFunction(
    () => document.querySelectorAll('.thread-children > article.blurt').length === 130,
  )
  await announced(page, '30 more replies loaded')
  const texts = await page
    .locator('.thread-children > article.blurt .blurt-body > p')
    .allTextContents()
  assert.deepEqual(
    texts,
    Array.from({ length: 130 }, (_, i) => `blurt ${i + 1}`),
  )
  assert.equal(await page.locator('.next-page').count(), 0)
  assert.ok(await samePage(page))
  assert.deepEqual(problems, [])
})
