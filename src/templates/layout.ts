import { h, type ComponentChildren } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import { publicUrl } from '../config.ts'
import { searchQueryMaxLength } from '../limits.ts'

// The document every HTML page shares: <head> with the title, meta description, share
// preview tags and canonical link, then the site search, the page and the footer.
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
  return html`
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <meta name="description" content=${meta.description ?? siteDescription} />
      ${meta.noindex && html`<meta name="robots" content="noindex" />`}
      ${canonical && html`<link rel="canonical" href=${canonical} />`}
      <link rel="icon" href=${faviconPath} type="image/svg+xml" />
      <link rel="stylesheet" href=${stylesheetUrl} />
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

// On every page, above the page's own header: a plain GET form, so it works without JS.
function SiteSearch({ query = '' }: { query?: string }) {
  return html`
    <form method="get" action="/search" role="search" class="site-search">
      <label for="site-search-q">Search</label>
      <input
        id="site-search-q"
        type="search"
        name="q"
        value=${query}
        maxlength=${searchQueryMaxLength}
        placeholder="Usernames and blurts"
      />
      <button type="submit">Search</button>
    </form>
  `
}

function Footer() {
  return html`
    <footer>
      <nav aria-label="About this site">
        <a href="/about">About</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
      </nav>
    </footer>
  `
}

// The doctype is added here as a string: htm has no syntax for it, and inside a template
// it would come out as the text "!doctype html" in the body.
export function renderDocument(
  page: ComponentChildren,
  meta: PageMeta = {},
  query?: string,
): string {
  return (
    '<!doctype html>' +
    renderToString(html`
      <html lang="en">
        <${Head} meta=${meta} />
        <body>
          <${SiteSearch} query=${query} />
          ${page}
          <${Footer} />
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
    <header>
      <h1>${title}</h1>
      <p class="tagline">Error ${status}</p>
    </header>
    <main class="error-page">
      <p>${message}</p>
      ${requestId && html`<p>Request id: <code>${requestId}</code></p>`}
      <p>
        <a href="/">Back to blurt.trade</a>
        ${status === 401 && html` · <a href="/login">Log in</a>`}
      </p>
    </main>
  `
}

// The styled page for an error status. `message` must be safe to show: for a 500 it is
// the generic one, never the error itself.
export function renderErrorPage(data: ErrorPageData): string {
  const title = errorTitles[data.status] ?? 'Error'
  return renderDocument(h(ErrorPage, data), { title, noindex: true })
}
