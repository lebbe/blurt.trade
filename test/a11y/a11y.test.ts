import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { criticalCss, themeStylesheetUrl, themes, type ThemeId } from '../../src/shared/themes.ts'

// Accessibility checks with axe-core on every page in every colour theme. The pages are the
// static HTML in test/snapshots/ (rendered from fixed data by test/snapshot.test.ts, so
// together they hold every component with dummy content), served from memory with public/
// behind /static/: no app server, no database. Run with `npm run a11y`.
//
// Each page is loaded once, as it is without JavaScript and with every <details> open, and
// checked against WCAG 2.2 A and AA and axe's best practices. Then colour contrast is checked
// in every theme, switched in place, with a copy of every button, link and summary forced
// into :hover and :focus-visible beside it, since a colour that only shows then can fail too.
// axe can't tell the contrast of text on a gradient (the Blurt button), so that isn't checked.
// It takes about 15 seconds on four cores: see the comments below before making it slower.
//
// ONLY=feed,login checks only the snapshots whose names start so, THEMES=plum-steel only
// that theme: handy while fixing something.

const root = join(import.meta.dirname, '..', '..')
const snapshotDir = join(root, 'test', 'snapshots')
const publicDir = join(root, 'public')
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)

const only = process.env.ONLY?.split(',')
const pages = readdirSync(snapshotDir)
  .filter((file) => file.endsWith('.html'))
  .map((file) => file.slice(0, -'.html'.length))
  .filter((name) => !only || only.some((prefix) => name.startsWith(prefix)))
const onlyThemes = process.env.THEMES?.split(',')
const checkedThemes: ThemeId[] = themes
  .map(({ id }) => id)
  .filter((id) => !onlyThemes || onlyThemes.includes(id))

// Colour contrast is checked separately, in every theme. `region` (all content in
// landmarks, a best practice rather than a WCAG rule) is off: each page's title and <h1>
// (.page-title, src/pages/shared/layout.ts) sit between the site's <header> and <main>, and
// moving them into <main> changes the layout.
const allButContrast = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
  },
  rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  resultTypes: ['violations'],
}
const contrastOnly = {
  runOnly: { type: 'rule', values: ['color-contrast'] },
  resultTypes: ['violations'],
}
const interactive = 'button, .button, a[href], summary'

// The snapshot with every theme's stylesheet linked (switched by setTheme below) and the
// critical CSS marked so setTheme can swap it; transitions and animations off, so a forced
// :hover shows its final colours at once.
function prepared(html: string): string {
  const themeLinks = themes
    .map(({ id }) => themeStylesheetUrl(id))
    .filter((url) => url !== null)
    .map((url) => `<link rel="stylesheet" href="${url}"/>`)
    .join('')
  return html
    .replace(/<style>[^<]*<\/style>/, '<style id="critical-css"></style>')
    .replace(/<link rel="stylesheet" href="\/static\/themes\/[^"]+"\/>/, '')
    .replace(
      '<link rel="stylesheet" href="/static/style.css"/>',
      `<link rel="stylesheet" href="/static/style.css"/>${themeLinks}` +
        '<style>*,*::before,*::after{transition:none!important;animation:none!important}</style>',
    )
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
}

// Checking is CPU-bound, in the browser: a few tabs per core keep them all busy.
const tabsAtOnce = availableParallelism() * 2

let browser: Browser | undefined
let context: BrowserContext | undefined

test.before(async () => {
  browser = await chromium.launch()
  context = await newContext(browser)
})

test.after(async () => {
  await browser?.close()
})

// The pages' scripts are answered with 404, so they are checked as they are without
// JavaScript. (Turning JavaScript off in the context would stop axe too: it needs timers.)
async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  await context.route('**/*', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.startsWith('/__snapshot/')) {
      const html = readFileSync(join(snapshotDir, `${pathname.slice(12)}.html`), 'utf8')
      return route.fulfill({ contentType: 'text/html', body: prepared(html) })
    }
    const file = normalize(join(publicDir, pathname.replace(/^\/static\//, '')))
    const type = contentTypes[extname(file)]
    if (pathname.startsWith('/static/') && file.startsWith(publicDir) && type) {
      try {
        return route.fulfill({ contentType: type, body: readFileSync(file) })
      } catch {}
    }
    // Scripts, pictures and avatars: not needed here.
    return route.fulfill({ status: 404, body: '' })
  })
  return context
}

// At most tabsAtOnce tabs open.
let open = 0
const waiting: (() => void)[] = []

async function withTab<T>(callback: (page: Page) => Promise<T>): Promise<T> {
  while (open >= tabsAtOnce) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  open++
  const page = await context!.newPage()
  try {
    return await callback(page)
  } finally {
    await page.close()
    open--
    waiting.shift()?.()
  }
}

// The theme's stylesheet on and the others off, and its critical CSS. All were loaded with
// the page, so this takes effect at once.
async function setTheme(page: Page, theme: ThemeId): Promise<void> {
  await page.evaluate(
    ([href, css]) => {
      // The style sheet's own disabled, not the <link>'s: that one drops the sheet, and
      // turning it back on fetches it again, after this has returned.
      for (const sheet of document.styleSheets) {
        if (sheet.href?.includes('/static/themes/')) {
          sheet.disabled = new URL(sheet.href).pathname !== href
        }
      }
      document.getElementById('critical-css')!.textContent = css
    },
    [themeStylesheetUrl(theme), criticalCss(theme)] as const,
  )
}

type Violation = {
  rule: string
  impact: string
  help: string
  nodes: { target: string; summary: string; key: string; hovered: boolean }[]
}

// axe's violations, each node with whether it is in a hovered copy (see addHoveredCopies)
// and a key that is the same for an element and its copy.
async function runAxe(page: Page, options: object): Promise<Violation[]> {
  return page.evaluate(async (options) => {
    // The number of the button, link or summary it is in, and the way down to it.
    const key = (element: Element) => {
      let path = ''
      for (let e: Element | null = element; e; e = e.parentElement) {
        if ((e as any).a11yNumber !== undefined) {
          return `${(e as any).a11yNumber}/${path}`
        }
        path = `${e.parentElement ? [...e.parentElement.children].indexOf(e) : 0}/${path}`
      }
      return null
    }
    const { violations } = await (window as any).axe.run(document, { ...options, elementRef: true })
    return violations.map((v: any) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n: any) => ({
        target: n.target.join(' '),
        summary: n.failureSummary,
        key: (key(n.element) ?? n.target.join(' ')) + n.failureSummary,
        hovered: n.element.closest('[data-a11y-hovered]') !== null,
      })),
    }))
  }, options)
}

// Every <details> open, so what is in them is checked too, and every button, link and
// summary numbered, so that a failure in one and the same in its copy is reported once (see
// runAxe and addHoveredCopies). In a property, not an attribute, which axe would put in the
// selectors it reports.
async function prepare(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    document.querySelectorAll('details').forEach((details) => (details.open = true))
    document.querySelectorAll(selector).forEach((e, i) => ((e as any).a11yNumber = i))
  }, interactive)
}

// A copy of every button, link and summary right after it, forced into :hover, :focus and
// :focus-visible through the DevTools protocol (as the :hov toggles in the Styles panel
// do). Each copy sits on the same background as the element, so one axe run checks both
// states: each run has a cost of its own, whatever it checks, and the runs are most of the
// time this takes.
async function addHoveredCopies(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    // The outermost only: a copy holds copies of what is in it.
    const elements = [...document.querySelectorAll(selector)].filter(
      (e) => !e.parentElement!.closest(selector),
    )
    for (const element of elements) {
      const copy = element.cloneNode(true) as Element
      copy.setAttribute('data-a11y-hovered', '')
      const originals = [element, ...element.querySelectorAll('*')]
      const copies = [copy, ...copy.querySelectorAll('*')]
      originals.forEach((original, i) => {
        ;(copies[i] as any).a11yNumber = (original as any).a11yNumber
        copies[i].removeAttribute('id')
      })
      element.after(copy)
    }
  }, interactive)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: `[data-a11y-hovered], [data-a11y-hovered] :is(${interactive})`,
  })
  await Promise.all(
    nodeIds.map((nodeId) =>
      cdp.send('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: ['hover', 'focus', 'focus-visible'],
      }),
    ),
  )
}

// Colour failures are labelled with their theme and state; the others hold in every theme.
// Each failure only once: what an earlier check found, or the element in its other state,
// is left out.
function report(theme: ThemeId, violations: Violation[], seen: Set<string>): string {
  let text = ''
  for (const v of violations) {
    for (const hovered of [false, true]) {
      const nodes = v.nodes.filter((n) => n.hovered === hovered && !seen.has(n.key))
      nodes.forEach((n) => seen.add(n.key))
      if (nodes.length > 0) {
        const label =
          v.rule === 'color-contrast' ? `${theme}${hovered ? ' :hover/:focus' : ''}: ` : ''
        text +=
          `\n[${v.impact}] ${label}${v.rule}: ${v.help}\n` +
          nodes.map((n) => `  ${n.target}\n    ${n.summary.replace(/\n/g, '\n    ')}`).join('\n')
      }
    }
  }
  return text
}

// One test per snapshot, all at once as far as withTab lets them.
test('a11y', { concurrency: true }, async (t) => {
  await Promise.all(
    pages.map((name) =>
      t.test(name, () =>
        withTab(async (page) => {
          await page.goto(`http://a11y.test/__snapshot/${name}`)
          await page.addScriptTag({ content: axeSource })
          await prepare(page)
          const seen = new Set<string>()
          let problems = ''
          // Everything but colours, as the page is.
          problems += report(checkedThemes[0], await runAxe(page, allButContrast), seen)
          // Colours in every theme, of everything and of the hovered copies.
          await addHoveredCopies(page)
          for (const theme of checkedThemes) {
            await setTheme(page, theme)
            problems += report(theme, await runAxe(page, contrastOnly), seen)
          }
          assert.equal(problems, '', `${name}:${problems}`)
        }),
      ),
    ),
  )
})
