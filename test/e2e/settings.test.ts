import test from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { samplePng } from '../helpers.ts'
import { bothModes, openTab, signUp } from './helpers.ts'

// The profile edit page: with JavaScript, settings save as they change and the map and the
// picture save a click, all without a page load (src/client/autosave.ts, map.ts, mouth.ts).
// Without it, the same forms with their buttons, as before.

// Opens the edit page and, with JavaScript, waits until every enhancer on it is ready (a
// change made before that is an ordinary form, as it should be, but not what is tested).
async function openEditPage(page: Page, hash = ''): Promise<void> {
  await page.goto(`/Lars/edit${hash}`)
  if (await page.evaluate(() => document.documentElement.dataset.js === 'on')) {
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLElement>('[data-enhance]')].every(
        (element) => element.dataset.enhanced === element.dataset.enhance,
      ),
    )
  }
}

// A mark on the window: it survives anything but a page load.
async function markWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { stillHere: boolean }).stillHere = true
  })
}

async function samePage(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere === true)
}

// Waits for a form's autosave to say "Saved".
async function saved(page: Page, form: string): Promise<void> {
  await page.locator(`${form} .autosave-status[role=status][data-state=saved]`).waitFor()
}

bothModes(
  'settings save as they change: a select, a checkbox and a text field',
  async ({ page }, javaScriptEnabled) => {
    await signUp(page, 'Lars')
    await openEditPage(page)
    if (javaScriptEnabled) {
      await markWindow(page)
      // The buttons are gone; a status line is in their place.
      assert.equal(
        await page.locator('form[action="/api/timezone"] button[type=submit]').isVisible(),
        false,
      )
    }

    const timeForm = 'form[action="/api/timezone"]'
    await page.selectOption(`${timeForm} select[name=timezone]`, 'Europe/Oslo')
    if (javaScriptEnabled) {
      await saved(page, timeForm)
    } else {
      await page.click(`${timeForm} button[type=submit]`)
      await page.waitForURL(/\/Lars\/edit#timezone$/)
    }

    const notificationsForm = 'form[action="/api/notifications/settings"]'
    await page.check(`${notificationsForm} input[name=followedBlurts]`)
    if (javaScriptEnabled) {
      await saved(page, notificationsForm)
    } else {
      await page.click(`${notificationsForm} button[type=submit]`)
      await page.waitForURL(/\/Lars\/edit#notifications$/)
    }

    // Typing: saved after a pause, without leaving the field.
    await page.fill('#profile-form textarea[name=bio]', 'Saved while typing')
    if (javaScriptEnabled) {
      await saved(page, '#profile-form')
      assert.ok(await samePage(page), 'no page load')
    } else {
      await page.click('#profile-form button[type=submit]')
      await page.waitForURL(/\/Lars\/$/)
    }

    await openEditPage(page)
    assert.equal(await page.inputValue(`${timeForm} select[name=timezone]`), 'Europe/Oslo')
    assert.ok(await page.isChecked(`${notificationsForm} input[name=followedBlurts]`))
    assert.equal(await page.inputValue('#profile-form textarea[name=bio]'), 'Saved while typing')
  },
)

test('autosave shows errors at their field and keeps the button', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page)
  await page.fill('#profile-form input[name=homepage]', 'not a url')
  await page.locator('#profile-form input[name=homepage]').blur()
  const error = page.locator('#profile-form [data-autosave-error]')
  await error.waitFor()
  assert.match((await error.textContent()) ?? '', /Homepage must be a full URL/)
  assert.equal(
    await page.getAttribute('#profile-form input[name=homepage]', 'aria-describedby'),
    await error.getAttribute('id'),
  )
  assert.ok(await page.locator('#profile-form button[type=submit]').isVisible())
  // Fixed: the error goes, and so does the button.
  await page.fill('#profile-form input[name=homepage]', 'https://example.com')
  await saved(page, '#profile-form')
  assert.equal(await error.count(), 0)
  assert.equal(await page.locator('#profile-form button[type=submit]').isVisible(), false)
  // The 400 is the only thing the console noted.
  assert.deepEqual(
    problems.filter((problem) => !/status of 400/.test(problem)),
    [],
  )
})

async function rootBackground(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  )
}

bothModes('the theme switches', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await openEditPage(page)
  assert.equal(await rootBackground(page), '#0a1323')
  if (javaScriptEnabled) {
    await markWindow(page)
  }
  for (const [theme, background] of [
    ['plum-steel', '#17121f'],
    ['forest-alloy', '#121a17'],
    ['cobalt-quietude', '#0a1323'],
  ]) {
    await page.check(`input[name=theme][value=${theme}]`)
    if (javaScriptEnabled) {
      await saved(page, 'form[action="/api/theme"]')
      await page.waitForFunction(
        (background) =>
          getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === background,
        background,
      )
      // The root's own background follows too, not only the panels.
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
        await page.evaluate((hex) => {
          const probe = document.createElement('i')
          probe.style.color = hex
          document.body.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()
          return color
        }, background),
      )
      const context = JSON.parse((await page.textContent('#page-context')) ?? '{}')
      assert.equal(context.theme, theme)
      assert.ok(await samePage(page), 'no page load')
      assert.equal(
        await page.locator('link[href^="/static/themes/"]:not([data-warm])').count(),
        theme === 'cobalt-quietude' ? 0 : 1,
      )
    } else {
      await page.click('form[action="/api/theme"] button[type=submit]')
      await page.waitForURL(/\/Lars\/edit#theme$/)
      assert.equal(await rootBackground(page), background)
      assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), background)
    }
  }
  await page.check('input[name=theme][value=tarnished-teal]')
  if (javaScriptEnabled) {
    await saved(page, 'form[action="/api/theme"]')
  } else {
    await page.click('form[action="/api/theme"] button[type=submit]')
    await page.waitForURL(/\/Lars\/edit#theme$/)
  }
  await page.goto('/')
  assert.equal(await rootBackground(page), '#191615')
})

const locationLine = 'section#location .location-status'

bothModes('a click on the map sets the location', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await openEditPage(page)
  assert.match((await page.textContent(locationLine)) ?? '', /You haven't set a location/)
  if (javaScriptEnabled) {
    await markWindow(page)
  }
  // Pixel (381, 60) is in the cell around 59.5° N, 10.5° E (Oslo's).
  await page.click('input[name=location]', { position: { x: 381, y: 60 } })
  await page.locator(locationLine, { hasText: '59.5° N, 10.5° E' }).waitFor()
  assert.equal(await page.locator('.map-marker circle').getAttribute('cx'), '381')
  assert.equal(await page.inputValue('select[name=timezone]'), 'Europe/Oslo')
  assert.equal(await samePage(page), javaScriptEnabled, 'a page load only without JavaScript')

  await openEditPage(page)
  assert.match((await page.textContent(locationLine)) ?? '', /59\.5° N, 10\.5° E/)
  if (javaScriptEnabled) {
    await markWindow(page)
  }
  await page.click('button:has-text("Remove my location")')
  await page.locator(locationLine, { hasText: "You haven't set a location" }).waitFor()
  assert.equal(await page.locator('.map-marker').count(), 0)
  assert.equal(await page.locator('button:has-text("Remove my location")').isVisible(), false)
  assert.equal(await samePage(page), javaScriptEnabled)
  await openEditPage(page)
  assert.match((await page.textContent(locationLine)) ?? '', /You haven't set a location/)
})

test('the map from the keyboard: arrows move the marker, Enter sets it', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page)
  await markWindow(page)
  const map = page.locator('input[name=location]')
  assert.match(
    (await page.textContent(`#${await map.getAttribute('aria-describedby')}`)) ?? '',
    /arrow keys/,
  )
  await map.focus()
  // Nothing stored and not moved yet: nothing to save.
  await page.keyboard.press('Enter')
  await page.locator('section#location .validation-error', { hasText: 'arrow keys' }).waitFor()

  // From the middle of the map (0.5° S, 0.5° E): three right, one more up.
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp']) {
    await page.keyboard.press(key)
  }
  assert.equal(await page.locator('.map-marker-pending').count(), 1)
  await page.keyboard.press('Enter')
  await page.locator(locationLine, { hasText: '0.5° N, 3.5° E' }).waitFor()
  assert.equal(await page.locator('.map-marker-pending').count(), 0)
  // Shift moves ten squares; Space saves too.
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Space')
  await page.locator(locationLine, { hasText: '10.5° N, 3.5° E' }).waitFor()
  assert.ok(await samePage(page))
  await openEditPage(page)
  assert.match((await page.textContent(locationLine)) ?? '', /10\.5° N, 3\.5° E/)
  assert.deepEqual(problems, [])
})

async function uploadPicture(page: Page): Promise<void> {
  await openEditPage(page, '#picture')
  await page.setInputFiles('form.picture-upload input[type=file]', {
    name: 'me.png',
    mimeType: 'image/png',
    buffer: samplePng(400, 400),
  })
  await page.click('form.picture-upload button[type=submit]:has-text("Upload picture")')
  await page.locator('form.cut-form input[name=cut]').waitFor()
  await openEditPage(page)
}

bothModes(
  'a click on the picture sets where the mouth opens',
  async ({ page }, javaScriptEnabled) => {
    await signUp(page, 'Lars')
    await uploadPicture(page)
    assert.match((await page.textContent('.cut-hint')) ?? '', /now 65% from the top/)
    if (javaScriptEnabled) {
      await markWindow(page)
    }
    // Half way down the 240 px picture.
    await page.click('input[name=cut]', { position: { x: 120, y: 120 } })
    await page.locator('.cut-hint', { hasText: 'now 50% from the top' }).waitFor()
    assert.match((await page.getAttribute('input[name=cut]', 'src')) ?? '', /-50-edit\.svg$/)
    // The talking preview was drawn again with the new cut.
    assert.match(
      (await page.getAttribute('.picture-editor .avatar-preview img.avatar-top', 'src')) ?? '',
      /-50-top\.svg$/,
    )
    assert.equal(await samePage(page), javaScriptEnabled, 'a page load only without JavaScript')
    await openEditPage(page)
    assert.match((await page.textContent('.cut-hint')) ?? '', /now 50% from the top/)
  },
)

test('the picture from the keyboard: arrows move the line, Enter saves it', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await uploadPicture(page)
  await markWindow(page)
  await page.focus('input[name=cut]')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowUp')
  // Shown straight away, saved only on Enter.
  assert.match((await page.getAttribute('input[name=cut]', 'src')) ?? '', /-62-edit\.svg$/)
  assert.match((await page.textContent('.cut-hint')) ?? '', /now 65%/)
  await page.keyboard.press('Enter')
  await page.locator('.cut-hint', { hasText: 'now 62% from the top' }).waitFor()
  assert.ok(await samePage(page))
  // Stepping through the lines quickly cancels the pictures not yet loaded: fine.
  assert.deepEqual(
    problems.filter((problem) => !/profile-pictures\/.*-edit\.svg net::ERR_ABORTED/.test(problem)),
    [],
  )
})

// Holds every request to `path` until release() (then it goes on to the server), so a test
// can see what the page does before the answer comes. `answer` instead gives that status
// with an error body, as a failed save.
async function holdRequests(
  page: Page,
  path: string,
  answer?: number,
): Promise<{ release: () => void; sent: () => number }> {
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
  return { release, sent: () => sent }
}

const avatarForm = 'form[action="/api/avatar"]'
const avatarPreview = `${avatarForm} .avatar-preview > svg.avatar`

// Waits until the cartoon preview is no longer `html` (drawn on the next frame).
async function redrawn(page: Page, html: string): Promise<void> {
  await page.waitForFunction(
    ([form, html]) => document.querySelector(`${form} .avatar-preview`)?.innerHTML !== html,
    [avatarForm, html],
  )
}

async function avatarFields(page: Page): Promise<Record<string, string>> {
  return page.evaluate((form) => {
    const element = document.querySelector<HTMLFormElement>(form)!
    return Object.fromEntries(
      [...new FormData(element)].map(([name, value]) => [name, String(value)]),
    )
  }, avatarForm)
}

// Sets a colour as dragging in the picker does: `input` events only, no `change` yet.
async function dragColour(page: Page, name: string, value: string): Promise<void> {
  await page.evaluate(
    ([form, name, value]) => {
      const field = document.querySelector<HTMLInputElement>(`${form} input[name=${name}]`)!
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [avatarForm, name, value],
  )
}

bothModes('the avatar is drawn as it is changed', async ({ page }, javaScriptEnabled) => {
  await signUp(page, 'Lars')
  await openEditPage(page, '#avatar')
  const before = await page.innerHTML(`${avatarForm} .avatar-preview`)
  const hair =
    (await page.inputValue(`${avatarForm} select[name=hairType]`)) === 'afro' ? 'bald' : 'afro'
  if (!javaScriptEnabled) {
    // Without JavaScript: pick, save, and the page that comes back shows it.
    await page.selectOption(`${avatarForm} select[name=hairType]`, hair)
    await page.fill(`${avatarForm} input[name=skin]`, '#123456')
    await page.click(`${avatarForm} button[type=submit]:not([name])`)
    await page.waitForURL(/\/Lars\/edit/)
    assert.equal(await page.inputValue(`${avatarForm} select[name=hairType]`), hair)
    assert.notEqual(await page.innerHTML(`${avatarForm} .avatar-preview`), before)
    assert.match(await page.innerHTML(`${avatarForm} .avatar-preview`), /fill="#123456"/)
    return
  }
  await markWindow(page)
  const held = await holdRequests(page, '/api/avatar')

  // Dragging a colour: drawn at once, nothing sent until the picker closes (`change`).
  await dragColour(page, 'skin', '#123456')
  await page.waitForFunction(
    (preview) => document.querySelector(preview)?.innerHTML.includes('fill="#123456"'),
    avatarPreview,
  )
  assert.equal(held.sent(), 0)
  const dragged = await page.innerHTML(`${avatarForm} .avatar-preview`)

  // A select: drawn before the server has answered.
  await page.selectOption(`${avatarForm} select[name=hairType]`, hair)
  await page.waitForFunction(() => document.querySelector('.autosave-status[data-state=saving]'))
  assert.equal(held.sent(), 1)
  await redrawn(page, dragged)
  const drawn = await page.innerHTML(`${avatarForm} .avatar-preview`)
  assert.match(drawn, /fill="#123456"/)
  held.release()
  await saved(page, avatarForm)
  assert.equal(await page.innerHTML(`${avatarForm} .avatar-preview`), drawn)

  // The new drawing talks on hover like the old one (motion allowed for this).
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.hover(avatarPreview)
  assert.equal(
    await page.$eval(`${avatarPreview} .avatar-top`, (top) => getComputedStyle(top).animationName),
    'avatar-talk',
  )
  assert.ok(await samePage(page), 'no page load')

  // What was saved is what the server draws.
  await openEditPage(page, '#avatar')
  assert.equal(await page.inputValue(`${avatarForm} select[name=hairType]`), hair)
  assert.equal(await page.inputValue(`${avatarForm} input[name=skin]`), '#123456')
})

test('Random draws a new avatar at once and saves it', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page, '#avatar')
  await markWindow(page)
  const before = await avatarFields(page)
  const preview = await page.innerHTML(`${avatarForm} .avatar-preview`)
  const held = await holdRequests(page, '/api/avatar')
  // Random can give the same avatar again, if rarely: press until it doesn't.
  let fields = before
  for (let tries = 0; tries < 5 && JSON.stringify(fields) === JSON.stringify(before); tries++) {
    await page.click(`${avatarForm} button[name=random]`)
    fields = await avatarFields(page)
  }
  assert.notDeepEqual(fields, before)
  assert.notEqual(await page.innerHTML(`${avatarForm} .avatar-preview`), preview)
  assert.ok(held.sent() >= 1, 'saving')
  held.release()
  await saved(page, avatarForm)
  fields = await avatarFields(page)
  assert.ok(await samePage(page))
  await openEditPage(page, '#avatar')
  assert.deepEqual(await avatarFields(page), fields)
  assert.deepEqual(problems, [])
})

test('a failed avatar save goes back to the saved avatar', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page, '#avatar')
  const before = await avatarFields(page)
  const preview = await page.innerHTML(`${avatarForm} .avatar-preview`)
  const held = await holdRequests(page, '/api/avatar', 500)
  const hair = before.hairType === 'afro' ? 'bald' : 'afro'
  await page.selectOption(`${avatarForm} select[name=hairType]`, hair)
  await page.waitForFunction(() => document.querySelector('.autosave-status[data-state=saving]'))
  await redrawn(page, preview)
  held.release()
  await page.locator(`${avatarForm} .autosave-status[role=status][data-state=error]`).waitFor()
  assert.match(
    (await page.textContent(`${avatarForm} .autosave-status[role=status]`)) ?? '',
    /Not saved/,
  )
  assert.deepEqual(await avatarFields(page), before)
  assert.equal(await page.innerHTML(`${avatarForm} .avatar-preview`), preview)
  assert.deepEqual(
    problems.filter((problem) => !/status of 500/.test(problem)),
    [],
  )
})

test("the viewer's own avatars elsewhere on the page are drawn again too", async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page, '#avatar')
  // Two blurt cards as the server draws them (src/ui/blurt-card.ts), one by Lars.
  await page.evaluate(() => {
    const card = (username: string) => `<article class="blurt"><div class="blurt-main">
      <svg class="avatar avatar-small" data-old="${username}"></svg>
      <div class="blurt-body"><div class="blurt-meta"><strong><a href="/${username}/">${username}</a></strong></div></div>
    </div></article>`
    document.querySelector('main')!.insertAdjacentHTML('beforeend', card('Lars') + card('Kari'))
  })
  await dragColour(page, 'skin', '#654321')
  await page.waitForFunction(() => !document.querySelector('svg[data-old=Lars]'))
  const own = page
    .locator('.blurt-meta a[href="/Lars/"]')
    .locator('xpath=ancestor::div[@class="blurt-main"]/*[1]')
  assert.match((await own.evaluate((svg) => svg.outerHTML)) ?? '', /fill="#654321"/)
  assert.equal(await page.locator('svg[data-old=Kari]').count(), 1)
  assert.deepEqual(problems, [])
})

const themeForm = 'form[action="/api/theme"]'

async function themeShown(page: Page, background: string): Promise<void> {
  await page.waitForFunction(
    (background) =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === background,
    background,
  )
}

test('a picked theme shows before it is saved', async (t) => {
  const { page, problems, requests } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page, '#theme')
  await markWindow(page)
  // The other themes' stylesheets are fetched ahead, never applied.
  await page.waitForFunction(
    () => document.querySelectorAll('link[data-warm][media="not all"]').length === 4,
  )
  await themeShown(page, '#0a1323')
  const held = await holdRequests(page, '/api/theme')
  await page.check(`${themeForm} input[value=plum-steel]`)
  await themeShown(page, '#17121f')
  assert.equal(held.sent(), 1)
  assert.equal(
    await page.locator(`${themeForm} .autosave-status[role=status]`).getAttribute('data-state'),
    'saving',
  )
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), '#17121f')
  const context = JSON.parse((await page.textContent('#page-context')) ?? '{}')
  assert.equal(context.theme, 'plum-steel')
  assert.equal(await page.locator('link[href^="/static/themes/"]:not([data-warm])').count(), 1)
  held.release()
  await saved(page, themeForm)
  assert.ok(await samePage(page), 'no page load')
  assert.equal(
    requests.filter((path) => path === '/static/themes/plum-steel.css').length >= 1,
    true,
  )
  await page.goto('/')
  await themeShown(page, '#17121f')
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), '#17121f')
  assert.deepEqual(problems, [])
})

test('a failed theme save goes back to the saved theme', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page, '#theme')
  const held = await holdRequests(page, '/api/theme', 500)
  await page.check(`${themeForm} input[value=forest-alloy]`)
  await themeShown(page, '#121a17')
  held.release()
  await page.locator(`${themeForm} .autosave-status[role=status][data-state=error]`).waitFor()
  await themeShown(page, '#0a1323')
  assert.ok(await page.isChecked(`${themeForm} input[value=cobalt-quietude]`))
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), '#0a1323')
  const context = JSON.parse((await page.textContent('#page-context')) ?? '{}')
  assert.equal(context.theme, 'cobalt-quietude')
  assert.equal(await page.locator('link[href^="/static/themes/"]:not([data-warm])').count(), 0)
  assert.deepEqual(
    problems.filter((problem) => !/status of 500/.test(problem)),
    [],
  )
})
