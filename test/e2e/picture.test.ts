import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { Page, Request } from 'playwright'
import { db } from '../../src/db.ts'
import {
  decodeUpload,
  encodeShapes,
  pictureFromUpload,
  pictureSvg,
  vectorize,
} from '../../src/picture.ts'
import { busyPicture, samplePng } from '../helpers.ts'
import { bothModes, enhancersReady, markWindow, openTab, samePage, signUp } from './helpers.ts'

// Pictures drawn in the browser before they are uploaded (src/client/picture-worker.ts,
// picture-preview.ts): the same drawing code as the server's, the profile picture's crop
// and mouth before the upload (picture-upload.ts), and the composer's preview
// (composer.ts). Without JavaScript nothing of it is there, and uploads work as before.

// The URL prefix the page's client modules are served under (src/client-modules.ts).
async function modulesBase(page: Page): Promise<string> {
  const main = await page.getAttribute('script[type=module]', 'src')
  assert.ok(main, 'the page has its script')
  return main.replace(/client\/main\.ts$/, '')
}

// Records what the page's fetch() calls send to `path` (Playwright doesn't give the bodies
// of multipart requests with files): the fields, and the file with its name and type.
type Sent = { fields: Record<string, string>; file?: { name: string; type: string; bytes: Buffer } }

async function recordSent(page: Page, path: string): Promise<() => Promise<Sent[]>> {
  await page.evaluate((path) => {
    const sent: unknown[] = []
    ;(window as unknown as { sent: unknown[] }).sent = sent
    const original = window.fetch
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.href)
      if (url.pathname === path && init?.body instanceof FormData) {
        const fields: Record<string, string> = {}
        let file
        for (const [name, value] of init.body) {
          if (typeof value === 'string') {
            fields[name] = value
          } else {
            const bytes = new Uint8Array(await value.arrayBuffer())
            let binary = ''
            for (const byte of bytes) binary += String.fromCharCode(byte)
            file = { name: value.name, type: value.type, bytes: btoa(binary) }
          }
        }
        sent.push({ fields, file })
      }
      return original(input, init)
    }
  }, path)
  return async () => {
    const sent = await page.evaluate(
      () =>
        (
          window as unknown as {
            sent: {
              fields: Record<string, string>
              file?: { name: string; type: string; bytes: string }
            }[]
          }
        ).sent,
    )
    return sent.map(({ fields, file }) => ({
      fields,
      file: file && { ...file, bytes: Buffer.from(file.bytes, 'base64') },
    }))
  }
}

// The browser's drawing of a file, from the page (the worker, as the previews use it):
// the stored format as base64, and its SVG (`cut`: the profile picture's edit part).
async function drawnInPage(
  page: Page,
  file: Buffer,
  options: { crop?: { x: number; y: number; size: number }; cut?: number } = {},
): Promise<{ shapes: string; svg: string; timings: Record<string, number> }> {
  return page.evaluate(
    async ({ base, file, options }) => {
      const preview = await import(`${base}client/picture-preview.ts`)
      const svg = await import(`${base}shared/picture/svg.ts`)
      const bytes = Uint8Array.from(atob(file), (c) => c.charCodeAt(0))
      const result = await preview.drawFile(new Blob([bytes]), { crop: options.crop })
      return {
        shapes: btoa(String.fromCharCode(...result.shapes)),
        svg:
          options.cut === undefined
            ? svg.pictureSvg(result.shapes)
            : svg.photoPartSvg(result.shapes, options.cut, 'edit'),
        timings: result.timings,
      }
    },
    { base: await modulesBase(page), file: file.toString('base64'), options },
  )
}

test('the same pixels give the same drawing in the browser as on the server', async (t) => {
  const { page, problems } = await openTab(t, true)
  await page.goto('/about')
  const base = await modulesBase(page)
  const images = [
    samplePng(),
    busyPicture(1200, 900),
    busyPicture(700, 1000, { circles: 200, type: 'image/jpeg' }),
  ]
  for (const file of images) {
    // Decoded and scaled by sharp, as the server does; then drawn by both.
    const image = await decodeUpload(file)
    assert.ok(image)
    const pixels = Buffer.from(image.data).toString('base64')
    const server = Buffer.from(encodeShapes(vectorize(image))).toString('base64')
    const browser = await page.evaluate(
      async ({ base, width, height, pixels }) => {
        const preview = await import(`${base}client/picture-preview.ts`)
        const data = Uint8ClampedArray.from(atob(pixels), (c) => c.charCodeAt(0))
        const result = await preview.drawPixels({ width, height, data })
        return btoa(String.fromCharCode(...result.shapes))
      },
      { base, width: image.width, height: image.height, pixels },
    )
    assert.equal(browser, server)
  }
  assert.deepEqual(problems, [])
})

test('the worker is our module, under the page CSP and its own', async (t) => {
  const { page, problems } = await openTab(t, true)
  const response = await page.goto('/about')
  assert.match(response?.headers()['content-security-policy'] ?? '', /worker-src 'self'/)
  const base = await modulesBase(page)
  const worker = await page.request.get(`${base}client/picture-worker.ts`)
  assert.equal(worker.status(), 200)
  assert.match(worker.headers()['content-type'] ?? '', /^text\/javascript/)
  assert.equal(worker.headers()['content-security-policy'], "default-src 'none'; script-src 'self'")
  // It imports only relative paths: the import map does not apply in a worker.
  for (const match of (await worker.text()).matchAll(/^import .* from '([^']+)'/gm)) {
    assert.match(match[1], /^\.\.?\//)
  }
  const drawn = await drawnInPage(page, samplePng(400, 200))
  assert.match(drawn.svg, /^<svg [^>]*viewBox="0 0 640 320"/)
  assert.deepEqual(problems, [])
})

test('how long drawing takes in the browser', async (t: TestContext) => {
  const { page, problems } = await openTab(t, true)
  await page.goto('/about')
  const photo = busyPicture(4000, 3000, { circles: 400, type: 'image/jpeg' })
  // The first drawing also starts the worker and compiles its code.
  const runs = []
  for (let i = 0; i < 3; i++) {
    const started = Date.now()
    const { timings } = await drawnInPage(page, photo)
    runs.push({
      ...(timings as { decode: number; scale: number; draw: number }),
      total: Date.now() - started,
    })
  }
  const image = (await decodeUpload(photo))!
  const started = performance.now()
  vectorize(image)
  const node = performance.now() - started
  const round = (n: number) => Math.round(n)
  t.diagnostic(
    `4000×3000 JPEG (${photo.length} bytes) drawn at 640×480: ${runs
      .map(
        (run) =>
          `total ${round(run.total)} ms (decode ${round(run.decode)}, scale ${round(run.scale)}, draw ${round(run.draw)})`,
      )
      .join('; ')}; vectorize in Node ${round(node)} ms`,
  )
  assert.ok(
    runs.every((run) => run.draw < 4000),
    'well under the server timeout',
  )
  assert.deepEqual(problems, [])
})

const pictureForm = 'form.picture-upload'

async function openPicturePanel(page: Page): Promise<void> {
  await page.goto('/Lars/edit#picture')
  await enhancersReady(page)
}

async function storedCut(): Promise<{ cut: number; version: number }> {
  const { rows } = await db().query<{ picture_cut: number; picture_version: number }>(
    'SELECT picture_cut, picture_version FROM user_profiles',
  )
  return { cut: rows[0].picture_cut, version: rows[0].picture_version }
}

test('profile picture: crop and mouth chosen before the upload, sent in one request', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  await openPicturePanel(page)
  await markWindow(page)
  const uploads = await recordSent(page, '/api/profile-picture')

  await page.setInputFiles(`${pictureForm} input[type=file]`, {
    name: 'me.jpg',
    mimeType: 'image/jpeg',
    buffer: busyPicture(1200, 900, { type: 'image/jpeg' }),
  })
  const status = page.locator('.crop-status')
  // The middle square, as the server would crop it.
  await status
    .filter({ hasText: 'Square of 900 × 900 pixels, 150 from the left and 0 from the top.' })
    .waitFor()
  await page.locator('.crop-drawing:not([hidden])').waitFor()
  assert.match((await page.textContent('.crop-note')) ?? '', /^Preview, drawn on your device/)

  // The crop as the status line says it, once it has changed from `before`.
  const cropAfter = async (before: string) => {
    await page.waitForFunction(
      (before) => document.querySelector('.crop-status')?.textContent !== before,
      before,
    )
    const text = (await status.textContent()) ?? ''
    const [size, , x, y] = (text.match(/\d+/g) ?? []).map(Number)
    return { text, size, x, y }
  }
  let crop = { text: (await status.textContent()) ?? '', size: 900, x: 150, y: 0 }

  // Keyboard: smaller twice (5 % of 900 each, about the middle), right 2 %, down 10 %.
  await page.focus('.crop-canvas')
  await page.keyboard.press('-')
  await page.keyboard.press('-')
  const smaller = await cropAfter(crop.text)
  assert.equal(smaller.size, 810)
  assert.ok(Math.abs(smaller.x - 195) <= 1 && Math.abs(smaller.y - 45) <= 1, smaller.text)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  crop = await cropAfter(smaller.text)
  // Down only as far as the picture goes: 900 − 810.
  assert.deepEqual([crop.size, crop.x, crop.y], [810, smaller.x + 18, 90])

  // Mouse: drag from inside the frame 40 CSS pixels left (the view is 320 px for 1200).
  const canvas = (await page.locator('.crop-canvas').boundingBox())!
  const perPixel = 1200 / canvas.width
  const at = (x: number, y: number) => ({ x: canvas.x + x / perPixel, y: canvas.y + y / perPixel })
  const middle = at(crop.x + 405, crop.y + 405)
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  await page.mouse.move(middle.x - 20, middle.y, { steps: 3 })
  await page.mouse.move(middle.x - 40, middle.y, { steps: 3 })
  await page.mouse.up()
  const moved = await cropAfter(crop.text)
  assert.equal(moved.size, 810)
  assert.equal(moved.y, crop.y)
  assert.ok(Math.abs(moved.x - (crop.x - 150)) <= 2, moved.text)
  crop = moved

  // Its corner, dragged up and left: smaller, still square, in the same place.
  const corner = at(crop.x + 810 - 4, crop.y + 810 - 4)
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x - 80, corner.y - 80, { steps: 4 })
  await page.mouse.up()
  const resized = await cropAfter(crop.text)
  assert.deepEqual([resized.x, resized.y], [crop.x, crop.y])
  // 80 CSS pixels are 300 of the picture's (give or take the mouse's whole pixels).
  assert.ok(Math.abs(resized.size - 510) <= 6, resized.text)

  // The size slider.
  await page.locator('.crop-size input').fill('100')
  assert.equal((await cropAfter(resized.text)).size, 900)

  // The mouth: a click 40 % down the drawing, then one step down with the keyboard.
  const drawing = (await page.locator('.crop-drawing').boundingBox())!
  await page.mouse.click(drawing.x + drawing.width / 2, drawing.y + 2 + (drawing.height - 4) * 0.4)
  await page.locator('.picture-crop .cut-hint', { hasText: 'now 40% from the top' }).waitFor()
  await page.focus('.crop-drawing')
  await page.keyboard.press('ArrowDown')
  await page.locator('.picture-crop .cut-hint', { hasText: 'now 41% from the top' }).waitFor()

  // The talking preview: the drawing's halves, split at 41 % of 640 (262), the top 8 more.
  const top = page.locator('.picture-crop .avatar-preview img.avatar-top')
  assert.match((await top.getAttribute('src')) ?? '', /^blob:/)
  assert.equal(await top.getAttribute('height'), '270')
  assert.equal(
    await page.locator('.picture-crop .avatar-preview img.avatar-jaw').getAttribute('height'),
    '378',
  )
  assert.equal(
    await page.getAttribute('.picture-crop .avatar-preview .avatar', 'aria-label'),
    'Preview of your profile picture',
  )

  // Nothing has left the browser yet.
  assert.equal((await uploads()).length, 0)
  assert.equal((await storedCut()).version, 0)

  await page.click(`${pictureForm} button[type=submit]:has-text("Upload picture")`)
  await page.locator('form.cut-form .cut-hint', { hasText: 'now 41% from the top' }).waitFor()
  assert.ok(await samePage(page), 'no page load')
  const sent = await uploads()
  assert.equal(sent.length, 1)
  const { fields, file: sentFile } = sent[0]
  assert.equal(fields.cut, '41')
  assert.deepEqual([sentFile?.name, sentFile?.type], ['picture.png', 'image/png'])
  const file = sentFile!.bytes
  assert.deepEqual([file.readUInt32BE(16), file.readUInt32BE(20)], [640, 640], 'the 640 px square')
  assert.deepEqual(await storedCut(), { cut: 41, version: 1 })
  // The panel was drawn again; its new enhancers work, and the editor is gone.
  assert.equal(await page.locator('.picture-crop').count(), 0)
  await enhancersReady(page)
  assert.equal(await page.locator(`${pictureForm} button[name=remove]`).count(), 1)

  // The server drew the very pixels the browser drew: the stored drawing is the preview.
  const edit = await page.getAttribute('form.cut-form input[name=cut]', 'src')
  const served = await (await page.request.get(edit!)).text()
  const browser = await drawnInPage(page, file, { crop: { x: 0, y: 0, size: 640 }, cut: 41 })
  assert.equal(browser.svg, served)

  // Remove, also without a page load.
  await page.click(`${pictureForm} button[name=remove]`)
  await page.locator(`${pictureForm} button[name=remove]`).waitFor({ state: 'detached' })
  assert.equal(await page.locator('form.cut-form').count(), 0)
  assert.ok(await samePage(page))
  assert.deepEqual(problems, [])
})

test('profile picture: the crop frame follows a finger', async (t) => {
  const { page, context, problems } = await openTab(t, true, {
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  })
  await signUp(page, 'Lars')
  await openPicturePanel(page)
  await page.setInputFiles(`${pictureForm} input[type=file]`, {
    name: 'me.png',
    mimeType: 'image/png',
    buffer: busyPicture(800, 400),
  })
  const status = page.locator('.crop-status')
  await status.filter({ hasText: 'Square of 400 × 400 pixels, 200 from the left' }).waitFor()
  await page.locator('.crop-canvas').scrollIntoViewIfNeeded()
  const canvas = (await page.locator('.crop-canvas').boundingBox())!
  assert.ok(canvas.x + canvas.width <= 390, 'fits the phone')
  const perPixel = 800 / canvas.width
  const from = { x: canvas.x + 400 / perPixel, y: canvas.y + 200 / perPixel }
  const cdp = await context.newCDPSession(page)
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  await touch('touchStart', [from])
  for (let step = 1; step <= 5; step++) {
    await touch('touchMove', [{ x: from.x + (step * 50) / perPixel, y: from.y }])
  }
  await touch('touchEnd', [])
  // 250 px right, but the frame stops at the picture's edge.
  await status
    .filter({ hasText: 'Square of 400 × 400 pixels, 400 from the left and 0 from the top.' })
    .waitFor()
  assert.deepEqual(problems, [])
})

test('profile picture without JavaScript: upload as before, then click for the mouth', async (t) => {
  const { page, problems } = await openTab(t, false)
  await signUp(page, 'Lars')
  await openPicturePanel(page)
  await page.setInputFiles(`${pictureForm} input[type=file]`, {
    name: 'me.png',
    mimeType: 'image/png',
    buffer: samplePng(400, 400),
  })
  assert.equal(await page.locator('.picture-crop').count(), 0)
  await page.click(`${pictureForm} button[type=submit]:has-text("Upload picture")`)
  await page.waitForURL(/\/Lars\/edit#picture$/)
  assert.match((await page.textContent('.cut-hint')) ?? '', /now 65% from the top/)
  assert.deepEqual(await storedCut(), { cut: 65, version: 1 })
  assert.deepEqual(problems, [])
})

const composer = 'section.composer form'

bothModes(
  'a picture in the composer: its drawing before posting',
  async ({ page }, javaScriptEnabled) => {
    await signUp(page, 'Lars')
    await page.goto('/')
    await enhancersReady(page)
    const posts: Request[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/blurts') {
        posts.push(request)
      }
    })
    // A PNG: its 640 px version is smaller, so that is sent. (A file that is smaller than
    // its scaled-down PNG, like a small JPEG, goes as it is.)
    const photo = busyPicture(1600, 1200)
    const pick = () =>
      page.setInputFiles(`${composer} input[name=picture]`, {
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: photo,
      })
    await pick()
    await page.fill(`${composer} textarea[name=text]`, 'Drawn first')
    if (!javaScriptEnabled) {
      assert.equal(await page.locator('.picture-preview').count(), 0)
      await page.click(`${composer} button[type=submit]`)
      await page.locator('article img.blurt-picture').waitFor()
      assert.equal(posts.length, 1)
      // The file as it was, drawn by the server alone.
      const served = await (
        await page.request.get((await page.getAttribute('article img.blurt-picture', 'src'))!)
      ).text()
      assert.equal(served, pictureSvg(encodeShapes((await pictureFromUpload(photo))!)))
      return
    }

    const preview = page.locator(`${composer} .picture-preview img:not([hidden])`)
    await preview.waitFor()
    assert.match((await preview.getAttribute('src')) ?? '', /^blob:/)
    assert.deepEqual(
      [await preview.getAttribute('width'), await preview.getAttribute('height')],
      ['640', '480'],
    )
    assert.match(
      (await page.textContent(`${composer} .picture-preview figcaption`)) ?? '',
      /^Preview, drawn on your device/,
    )

    // Removed, and picked again.
    await page.click(`${composer} .picture-preview button:has-text("Remove picture")`)
    assert.equal(await page.locator(`${composer} .picture-preview`).count(), 0)
    assert.equal(await page.inputValue(`${composer} input[name=picture]`), '')
    await pick()
    await preview.waitFor()
    assert.equal(posts.length, 0, 'nothing sent before posting')

    await markWindow(page)
    const sent = await recordSent(page, '/api/blurts')
    await page.click(`${composer} button[type=submit]`)
    const picture = page.locator('article img.blurt-picture')
    await picture.waitFor()
    assert.ok(await samePage(page))
    assert.equal(posts.length, 1)
    // The picture went up scaled down to the 640 px it is drawn at, as a PNG: smaller…
    const [{ file: sentFile }] = await sent()
    assert.deepEqual([sentFile?.name, sentFile?.type], ['picture.png', 'image/png'])
    const file = sentFile!.bytes
    assert.ok(file.length < photo.length)
    assert.deepEqual([file.readUInt32BE(16), file.readUInt32BE(20)], [640, 480])
    // …and the server's drawing of it is the browser's.
    const served = await (await page.request.get((await picture.getAttribute('src'))!)).text()
    assert.equal((await drawnInPage(page, file)).svg, served)
  },
)

test('profile picture: uploading and removing in place leave the page as a reload draws it', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  // What the edit page shows of the cartoon: its form, and the aside's link to it.
  const cartoon = () =>
    page.evaluate(() => ({
      form: document.querySelectorAll('form.avatar-form').length,
      anchor: document.getElementById('avatar')?.localName,
      link: document.querySelectorAll('aside a[href="#avatar"]').length,
    }))
  await openPicturePanel(page)
  const withoutPicture = await cartoon()
  assert.deepEqual(withoutPicture, { form: 1, anchor: 'section', link: 1 })
  await markWindow(page)

  await page.setInputFiles(`${pictureForm} input[type=file]`, {
    name: 'me.png',
    mimeType: 'image/png',
    buffer: samplePng(400, 400),
  })
  await page.locator('.picture-crop').waitFor()
  await page.click(`${pictureForm} button[type=submit]:has-text("Upload picture")`)
  await page.locator('form.cut-form').waitFor()
  assert.ok(await samePage(page), 'no page load')
  // The cartoon's form is gone, as after a reload, so its fields can't draw a cartoon over
  // the picture's preview (it showed the photo, which is what is stored).
  const inPlace = await cartoon()
  assert.deepEqual(inPlace, { form: 0, anchor: 'span', link: 0 })
  await openPicturePanel(page)
  assert.deepEqual(await cartoon(), inPlace)

  // Removing it brings the cartoon's form back, working (autosave), as a reload would.
  await markWindow(page)
  await page.click(`${pictureForm} button[name=remove]`)
  await page.locator(`${pictureForm} button[name=remove]`).waitFor({ state: 'detached' })
  assert.ok(await samePage(page))
  assert.deepEqual(await cartoon(), withoutPicture)
  await enhancersReady(page)
  await page.fill('form.avatar-form input[name=skin]', '#123456')
  await page.locator('form.avatar-form .autosave-status[data-state=saved]').waitFor()
  assert.match(await page.innerHTML('form.avatar-form .avatar-preview'), /fill="#123456"/)
  await openPicturePanel(page)
  assert.deepEqual(await cartoon(), withoutPicture)
  assert.deepEqual(problems, [])
})
