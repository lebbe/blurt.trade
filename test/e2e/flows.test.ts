import assert from 'node:assert/strict'
import { bothModes, scriptRan, signUp } from './helpers.ts'

// The same flows with the browser's JavaScript off and on. With it on, main.ts loads on
// every page and must change nothing a user does; with it off, nothing must be missing.

bothModes('sign up, blurt, like and log out', async ({ page, requests }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  assert.equal(await scriptRan(page), javaScriptEnabled)
  assert.equal(
    requests.some((path) => path.endsWith('/client/main.ts')),
    javaScriptEnabled,
    'main.ts is fetched only with JavaScript on',
  )

  await page.fill('form[action="/api/blurts"] textarea[name=text]', 'Hello from a browser')
  await page.click('form[action="/api/blurts"] button[type=submit]')
  const blurt = page.locator('article.blurt', { hasText: 'Hello from a browser' }).first()
  await blurt.waitFor()

  await blurt.locator('form[action="/api/like"] button').click()
  await page
    .locator('article.blurt', { hasText: 'Hello from a browser' })
    .first()
    .locator('form[action="/api/unlike"]')
    .waitFor()
  assert.match(
    (await page
      .locator('article.blurt', { hasText: 'Hello from a browser' })
      .first()
      .locator('form[action="/api/unlike"] .like-count')
      .textContent()) ?? '',
    /^1 like/,
  )
  assert.equal(await scriptRan(page), javaScriptEnabled)

  await page.click('form[action="/api/logout"] button')
  await page.locator('a[href="/login"]').first().waitFor()
})

bothModes(
  'every page of the frame loads, with main.ts only when JavaScript runs',
  async ({ page, problems }, javaScriptEnabled) => {
    for (const path of [
      '/',
      '/people',
      '/search?q=hello',
      '/about',
      '/privacy',
      '/terms',
      '/login',
    ]) {
      const response = await page.goto(path)
      assert.equal(response?.status(), 200, path)
      assert.equal(await scriptRan(page), javaScriptEnabled, path)
    }
    const missing = await page.goto('/no/such/page')
    assert.equal(missing?.status(), 404)
    assert.equal(await scriptRan(page), javaScriptEnabled, '404')
    // The console notes the page's own 404, and nothing else.
    assert.deepEqual(problems.splice(0), [
      'console: Failed to load resource: the server responded with a status of 404 (Not Found)',
    ])
  },
)

bothModes(
  'anonymous visitors turn JavaScript off and on from the footer',
  async ({ page, requests }) => {
    await page.goto('/')
    await page.click('footer a:has-text("Turn JavaScript off")')
    await page.waitForURL(/\/about#javascript$/)
    await page.click('#javascript button:has-text("Turn JavaScript off")')
    await page.locator('#javascript button:has-text("Turn JavaScript on")').waitFor()

    // Off: not a single script is sent, whether or not the browser would run it.
    requests.length = 0
    await page.goto('/')
    assert.equal(await scriptRan(page), false)
    assert.equal(await page.locator('script, link[rel=modulepreload]').count(), 0)
    assert.deepEqual(
      requests.filter(
        (path) => path.startsWith('/static/js/') || path.startsWith('/static/vendor/'),
      ),
      [],
    )
    assert.equal(await page.locator('footer a:has-text("Turn JavaScript on")').count(), 1)

    await page.click('footer a:has-text("Turn JavaScript on")')
    await page.click('#javascript button:has-text("Turn JavaScript on")')
    await page.locator('#javascript button:has-text("Turn JavaScript off")').waitFor()
    assert.ok((await page.locator('script[type=module]').count()) === 1)
  },
)

bothModes(
  'logged-in users turn JavaScript off and on in Settings',
  async ({ page }, javaScriptEnabled) => {
    await signUp(page, 'Ada')
    await page.click('footer a:has-text("Turn JavaScript off")')
    await page.waitForURL(/\/settings#javascript$/)
    await page.click('#javascript button:has-text("Turn JavaScript off")')
    await page.locator('#javascript button:has-text("Turn JavaScript on")').waitFor()
    for (const path of ['/', '/settings', '/Ada/', '/Ada/edit']) {
      await page.goto(path)
      assert.equal(await scriptRan(page), false, path)
      assert.equal(await page.locator('script').count(), 0, path)
    }
    await page.goto('/settings')
    await page.click('#javascript button:has-text("Turn JavaScript on")')
    await page.locator('#javascript button:has-text("Turn JavaScript off")').waitFor()
    assert.equal(await scriptRan(page), javaScriptEnabled)
  },
)
