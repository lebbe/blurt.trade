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
        await page.locator('link[href^="/static/themes/"]').count(),
        theme === 'cobalt-quietude' ? 0 : 1,
      )
    } else {
      await page.click('form[action="/api/theme"] button[type=submit]')
      await page.waitForURL(/\/Lars\/edit#theme$/)
      assert.equal(await rootBackground(page), background)
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

test('the avatar saves as it changes, and Random fills in the fields', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openEditPage(page)
  await markWindow(page)
  const form = 'form[action="/api/avatar"]'
  const preview = () => page.innerHTML(`${form} .avatar-preview`)
  const answer = () =>
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/avatar')
  const before = await preview()
  const hair = (await page.inputValue(`${form} select[name=hairType]`)) === 'afro' ? 'bald' : 'afro'
  const changed = answer()
  await page.selectOption(`${form} select[name=hairType]`, hair)
  await changed
  await saved(page, form)
  assert.notEqual(await preview(), before, 'the preview is drawn again')

  // Random is still a button; the server picks, and the fields show what it picked.
  const random = answer()
  await page.click(`${form} button[name=random]`)
  await random
  await saved(page, form)
  const fields = await page.evaluate((form) => {
    const element = document.querySelector<HTMLFormElement>(form)!
    return Object.fromEntries(
      [...new FormData(element)].map(([name, value]) => [name, String(value)]),
    )
  }, form)
  assert.ok(await samePage(page))
  await openEditPage(page)
  for (const [name, value] of Object.entries(fields)) {
    assert.equal(await page.inputValue(`${form} [name=${name}]`), value, name)
  }
  assert.deepEqual(problems, [])
})
