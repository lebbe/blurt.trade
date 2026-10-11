import { h, type ComponentChildren } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import { publicUrl } from '../config.ts'
import { searchQueryMaxLength } from '../limits.ts'
import { pageContext } from '../page-context.ts'
import { criticalCss, themeStylesheetUrl } from '../themes.ts'
import { Icon, type IconName } from './icons.ts'

// The document every HTML page shares: <head> with the title, meta description, share
// preview tags, canonical link and stylesheets, then the page (framed by Page) and the footer.
// Depends on nothing route-specific, so error handlers (src/negotiate.ts, src/logging.ts)
// can render pages without importing the routes.

const html = htm.bind(h)

export const siteName = 'blurt.trade'
export const siteDescription = 'Say the thing. Regret it later.'

// The share preview image (public/og-image.png), and the favicon (public/favicon.svg).
export const previewImagePath = '/static/og-image.png'
export const previewImageSize = { width: 1200, height: 630 }
export const faviconPath = '/static/favicon.svg'
export const stylesheetUrl = '/static/style.css'

// What a page tells search engines and link previews. Everything is optional: a page
// without a title is just "blurt.trade". Text from users goes in as is; Preact escapes
// attributes, and preview() trims it.
export type PageMeta = {
  title?: string // shown as "<title> · blurt.trade"
  description?: string
  canonical?: string // the page's path without cursors, e.g. /Lars/
  noindex?: boolean
  // Open Graph / Twitter card tags, for pages people share: profiles, blurts, feeds.
  share?: { type: 'website' | 'profile' | 'article'; title: string; description: string }
}

// Text for a title or description: whitespace collapsed, at most `max` characters (code
// points, so an emoji is never cut in half), with an ellipsis when cut.
export function preview(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length <= max
    ? chars.join('')
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

function Head({ meta }: { meta: PageMeta }) {
  const origin = publicUrl()
  const title = meta.title ? `${meta.title} · ${siteName}` : siteName
  const canonical = meta.canonical && `${origin}${meta.canonical}`
  const share = meta.share
  const { theme } = pageContext()
  const themeUrl = themeStylesheetUrl(theme)
  return html`
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <meta name="description" content=${meta.description ?? siteDescription} />
      ${meta.noindex && html`<meta name="robots" content="noindex" />`}
      ${canonical && html`<link rel="canonical" href=${canonical} />`}
      <link rel="icon" href=${faviconPath} type="image/svg+xml" />
      <style dangerouslySetInnerHTML=${{ __html: criticalCss(theme) }}></style>
      <link rel="stylesheet" href=${stylesheetUrl} />
      ${themeUrl && html`<link rel="stylesheet" href=${themeUrl} />`}
      ${
        share &&
        html`
          <meta property="og:site_name" content=${siteName} />
          <meta property="og:type" content=${share.type} />
          <meta property="og:title" content=${share.title} />
          <meta property="og:description" content=${share.description} />
          ${canonical && html`<meta property="og:url" content=${canonical} />`}
          <meta property="og:image" content=${`${origin}${previewImagePath}`} />
          <meta property="og:image:width" content=${String(previewImageSize.width)} />
          <meta property="og:image:height" content=${String(previewImageSize.height)} />
          <meta property="og:image:alt" content=${`${siteName}: ${siteDescription}`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content=${share.title} />
          <meta name="twitter:description" content=${share.description} />
        `
      }
    </head>
  `
}

// In the header of every page but /search (whose page is a bigger copy of it): a plain GET
// form, so it works without JS.
function SiteSearch() {
  return html`
    <form method="get" action="/search" role="search" class="site-search">
      <label for="site-search-q" class="visually-hidden">Search</label>
      <input
        id="site-search-q"
        type="search"
        name="q"
        maxlength=${searchQueryMaxLength}
        placeholder="Search people and blurts"
      />
      <button type="submit" class="secondary"><${Icon} name="search" /><span>Search</span></button>
    </form>
  `
}

type NavItem = { href: string; label: string; icon: IconName; current: boolean }

// Every destination, on every page, always visible: no menus to open. Logged-in viewers
// get their profile and settings; everyone else the way in.
function navItems(): NavItem[] {
  const { viewer, path } = pageContext()
  const item = (href: string, label: string, icon: IconName, current = path === href) => ({
    href,
    label,
    icon,
    current,
  })
  if (!viewer) {
    return [
      item('/', 'Home', 'home'),
      item('/search', 'Search', 'search'),
      item('/login', 'Log in', 'login'),
      item('/createUser', 'Sign up', 'personPlus'),
    ]
  }
  const profile = `/${viewer.username}/`
  return [
    item('/', 'Home', 'home'),
    item('/everyone', 'Everyone', 'globe'),
    item('/search', 'Search', 'search'),
    item('/near', 'Near', 'pin'),
    item(profile, 'Profile', 'person', path === profile || path === `/${viewer.username}/edit`),
    item('/settings', 'Settings', 'sliders', path.startsWith('/settings')),
  ]
}

function TopNav() {
  return html`
    <nav class="top-nav" aria-label="Main">
      ${navItems().map(
        ({ href, label, icon, current }) =>
          html`<a href=${href} aria-current=${current ? 'page' : undefined}
            ><${Icon} name=${icon} /><span>${label}</span></a
          >`,
      )}
    </nav>
  `
}

// The frame of every page: the header (title, the page's own buttons, search and the
// navigation), then the page in <main>, with `aside` beside it on wide screens and under
// it on narrow ones. `lead` goes before the title (a profile's avatar).
export function Page({
  title,
  tagline,
  lead,
  actions,
  aside,
  search = true,
  children,
}: {
  title: ComponentChildren
  tagline?: ComponentChildren
  lead?: ComponentChildren
  actions?: ComponentChildren
  aside?: ComponentChildren
  search?: boolean
  children?: ComponentChildren
}) {
  return html`
    <header class="site-head">
      <div class="brand-row">
        <div class="brand">
          ${lead}
          <div>
            <h1>${title}</h1>
            ${tagline && html`<p class="tagline">${tagline}</p>`}
          </div>
        </div>
        ${(actions || search) && html`<div class="head-actions">${actions} ${search && html`<${SiteSearch} />`}</div>`}
      </div>
      <${TopNav} />
    </header>
    <div class=${aside ? 'layout' : 'layout single'}>
      <main>${children}</main>
      ${aside && html`<aside>${aside}</aside>`}
    </div>
  `
}

function Footer() {
  return html`
    <footer>
      <nav aria-label="About this site">
        <a href="/">blurt.trade</a> · <a href="/about">About</a> ·
        <a href="/terms">Terms</a>${' · '}<a href="/privacy">Privacy</a>
      </nav>
    </footer>
  `
}

// The doctype is added here as a string: htm has no syntax for it, and inside a template
// it would come out as the text "!doctype html" in the body.
export function renderDocument(page: ComponentChildren, meta: PageMeta = {}): string {
  return (
    '<!doctype html>' +
    renderToString(html`
      <html lang="en">
        <${Head} meta=${meta} />
        <body>
          <div class="shell">${page} <${Footer} /></div>
        </body>
      </html>
    `)
  )
}

// --- Error pages --------------------------------------------------------------------------

const errorTitles: Record<number, string> = {
  400: 'Bad request',
  401: 'Log in first',
  403: 'Not allowed',
  404: 'Not found',
  406: 'Not acceptable',
  409: 'Conflict',
  413: 'Too large',
  429: 'Too many requests',
  500: 'Something went wrong',
}

export type ErrorPageData = { status: number; message: string; requestId?: string }

function ErrorPage({ status, message, requestId }: ErrorPageData) {
  const title = errorTitles[status] ?? (status >= 500 ? errorTitles[500] : 'Error')
  return html`
    <${Page} title=${title} tagline=${`Error ${status}`}>
      <section class="panel error-page">
        <p>${message}</p>
        ${requestId && html`<p class="tiny">Request id: <code>${requestId}</code></p>`}
        <div class="actions">
          <a class="button secondary" href="/"
            ><${Icon} name="back" /><span>Back to blurt.trade</span></a
          >
          ${
            status === 401 &&
            html`<a class="button" href="/login"><${Icon} name="login" /><span>Log in</span></a>`
          }
        </div>
      </section>
    <//>
  `
}

// The styled page for an error status. `message` must be safe to show: for a 500 it is
// the generic one, never the error itself.
export function renderErrorPage(data: ErrorPageData): string {
  const title = errorTitles[data.status] ?? 'Error'
  return renderDocument(h(ErrorPage, data), { title, noindex: true })
}
