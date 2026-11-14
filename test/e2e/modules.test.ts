import test from 'node:test'
import assert from 'node:assert/strict'
import { clientModulePaths, clientModuleUrl } from '../../src/client-modules.ts'
import { preactBundleUrl } from '../../src/vendor.ts'
import { openTab, scriptRan, signUp } from './helpers.ts'

// The client modules in a real browser, on a real page: served type-stripped from src/
// under the page's CSP and import map (src/client-modules.ts).

test('every client module can be imported in the browser', async (t) => {
  const { page, problems } = await openTab(t, true)
  await page.goto('/')
  assert.ok(await scriptRan(page))
  const urls = clientModulePaths().map(clientModuleUrl)
  const results = await page.evaluate(
    (urls) =>
      Promise.all(
        urls.map((url) =>
          import(url).then(
            (module: object) => ({ url, exports: Object.keys(module) }),
            (error: Error) => ({ url, error: String(error) }),
          ),
        ),
      ),
    urls,
  )
  assert.deepEqual(
    results.filter((result) => 'error' in result),
    [],
  )
  // html.ts is the bundle in the browser (the import map), so it has all of Preact.
  const htmlModule = results.find((result) => result.url === clientModuleUrl('ui/html.ts'))
  assert.ok(htmlModule && 'exports' in htmlModule && htmlModule.exports.includes('render'))
  assert.deepEqual(problems, [])
})

test('shared components render in the browser with the page context, on one Preact', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Grace')
  const rendered = await page.evaluate(
    async ({ contextUrl, providerUrl, htmlUrl, bundleUrl }) => {
      const { render } = await import('preact')
      const { usePageContext } = await import(contextUrl)
      const { PageContextProvider, readPageContext } = await import(providerUrl)
      const { html } = await import(htmlUrl)
      const bundle = await import(bundleUrl)
      function Who() {
        const { viewer, path, javascript } = usePageContext()
        return html`<p>${viewer?.username} on ${path}, JavaScript ${javascript ? 'on' : 'off'}</p>`
      }
      const root = document.createElement('div')
      document.body.append(root)
      render(html`<${PageContextProvider} value=${readPageContext()}><${Who} /><//>`, root)
      return { text: root.textContent, onePreact: bundle.render === render }
    },
    {
      contextUrl: clientModuleUrl('ui/context.ts'),
      providerUrl: clientModuleUrl('client/page-context.ts'),
      htmlUrl: clientModuleUrl('ui/html.ts'),
      bundleUrl: preactBundleUrl,
    },
  )
  assert.deepEqual(rendered, { text: 'Grace on /, JavaScript on', onePreact: true })
  assert.deepEqual(problems, [])
})

test('an enhancer that fails breaks neither the others nor the page', async (t) => {
  const { page } = await openTab(t, true)
  await page.goto('/')
  const outcome = await page.evaluate(async (enhanceUrl) => {
    const { enhanceAll } = await import(enhanceUrl)
    const root = document.createElement('section')
    root.innerHTML =
      '<p data-enhance="good"></p><p data-enhance="throws good"></p><p data-enhance="missing"></p><p data-enhance="unloadable"></p>'
    document.body.append(root)
    const registry = {
      good: async () => ({
        enhance: (element: HTMLElement) => {
          element.textContent = `${element.textContent}ok`
        },
      }),
      throws: async () => ({
        enhance: () => {
          throw new Error('broken enhancer')
        },
      }),
      unloadable: () => Promise.reject(new Error('404')),
    }
    const first = await enhanceAll(root, registry, { page: {} })
    // Again, as after new content arrives: nothing is enhanced twice.
    const second = await enhanceAll(root, registry, { page: {} })
    return {
      statuses: first.map(
        (result: { name: string; status: string }) => `${result.name}:${result.status}`,
      ),
      second: second.length,
      texts: [...root.children].map((element) => element.textContent),
      marked: [...root.children].map((element) => (element as HTMLElement).dataset.enhanced ?? ''),
    }
  }, clientModuleUrl('client/enhance.ts'))
  assert.deepEqual(outcome, {
    statuses: [
      'good:enhanced',
      'throws:failed',
      'good:enhanced',
      'missing:unknown',
      'unloadable:failed',
    ],
    second: 0,
    texts: ['ok', 'ok', '', ''],
    marked: ['good', 'good', '', ''],
  })
})

test('submitForm and followLink: JSON when it works, the real thing when not', async (t) => {
  const { page, problems } = await openTab(t, true)
  await signUp(page, 'Lars')
  const requestsUrl = clientModuleUrl('client/requests.ts')

  // Success: the composer (a multipart form) answers 201 with the blurt; nothing reloads.
  await page.fill('form[action="/api/blurts"] textarea[name=text]', 'Sent with fetch')
  const success = await page.evaluate(async (url) => {
    const { submitForm } = await import(url)
    const form = document.querySelector<HTMLFormElement>('form[action="/api/blurts"]')
    const outcome = await submitForm(form)
    return { kind: outcome.kind, status: outcome.status, text: outcome.data?.text }
  }, requestsUrl)
  assert.deepEqual(success, { kind: 'success', status: 201, text: 'Sent with fetch' })

  // Errors: the server's messages, for the enhancer to show.
  const errors = await page.evaluate(async (url) => {
    const { submitForm } = await import(url)
    const form = document.createElement('form')
    form.method = 'post'
    form.action = '/api/blurts'
    form.innerHTML = '<input name="text" value="">'
    document.body.append(form)
    return submitForm(form)
  }, requestsUrl)
  assert.equal(errors.kind, 'errors')
  assert.equal(errors.status, 400)
  assert.ok(errors.errors.length > 0)

  // A page's data with followLink, and no navigation with fallback off.
  const data = await page.evaluate(async (url) => {
    const { followLink } = await import(url)
    const outcome = await followLink('/people', { fallback: false })
    return {
      kind: outcome.kind,
      people: outcome.data?.people?.map((p: { username: string }) => p.username),
    }
  }, requestsUrl)
  assert.deepEqual(data, { kind: 'success', people: ['Lars'] })

  // The network fails: the form is submitted for real, without the handler,
  // and the browser shows the server's answer as it would without JavaScript.
  await page.route('**/api/blurts', (route, request) =>
    request.headers().accept === 'application/json' ? route.abort() : route.continue(),
  )
  await page.goto('/')
  await page.fill('form[action="/api/blurts"] textarea[name=text]', 'Sent for real')
  await Promise.all([
    page.waitForURL(`${new URL(page.url()).origin}/`, { waitUntil: 'load' }),
    page.evaluate(async (url) => {
      const { submitForm } = await import(url)
      const form = document.querySelector<HTMLFormElement>('form[action="/api/blurts"]')
      const outcome = await submitForm(form, {
        submitter: form?.querySelector('button[type=submit]'),
      })
      document.title = outcome.kind
    }, requestsUrl),
  ])
  await page.locator('article.blurt', { hasText: 'Sent for real' }).first().waitFor()
  // Only what this test did on purpose went wrong: the 400 and the aborted fetch.
  assert.deepEqual(problems.sort(), [
    'console: Failed to load resource: net::ERR_FAILED',
    'console: Failed to load resource: the server responded with a status of 400 (Bad Request)',
    `failed: ${new URL(page.url()).origin}/api/blurts net::ERR_FAILED`,
  ])
})
