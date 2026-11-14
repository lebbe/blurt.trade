import type { ComponentChildren, VNode } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { publicUrl } from '../../config.ts'
import { pageContext } from '../../page-context.ts'
import { searchQueryMaxLength } from '../../shared/limits.ts'
import { criticalCss, themeStylesheetUrl } from '../../shared/themes.ts'
import { importMapJson, mainModulePreloads, mainModuleUrl } from '../../client-modules.ts'
import {
  pageContextElementId,
  PageContextValue,
  usePageContext,
  type PageContext,
} from '../../ui/context.ts'
import { html } from '../../ui/html.ts'
import { Icon, type IconName } from '../../ui/icons.ts'
import { UnreadBadge } from '../../ui/notifications.ts'
import { javascriptSettingPath } from '../../ui/urls.ts'

// The document every HTML page shares: <head> with the title, meta description, share
// preview tags, canonical link and stylesheets, then the page (framed by Page) and the footer.
// Depends on nothing route-specific, so error handlers (src/negotiate.ts, src/logging.ts)
// can render pages without importing the routes.

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
  author?: string // a username, for pages that are one person's
  // Open Graph / Twitter card tags, for pages people share: profiles, blurts, feeds.
  share?: {
    type: 'website' | 'profile' | 'article'
    title: string
    description: string
    image?: string
    imageAlt?: string
    imageType?: 'image/png' | 'image/jpeg' // of `image`; PNG when missing
    publishedTime?: string
    themeColor?: string
  }
}

// The longest title a share preview gets (user text is trimmed with preview()).
export const shareTitleMax = 70

function Head({ meta }: { meta: PageMeta }) {
  const origin = publicUrl()
  const title = meta.title ? `${meta.title} · ${siteName}` : siteName
  const canonical = meta.canonical && `${origin}${meta.canonical}`
  const share = meta.share
  const { theme } = usePageContext()
  const themeUrl = themeStylesheetUrl(theme)
  return html`
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <meta name="description" content=${meta.description ?? siteDescription} />
      ${meta.author && html`<meta name="author" content=${meta.author} />`}
      ${meta.noindex && html`<meta name="robots" content="noindex" />`}
      ${canonical && html`<link rel="canonical" href=${canonical} />`}
      <link rel="icon" href=${faviconPath} type="image/svg+xml" />
      <style dangerouslySetInnerHTML=${{ __html: criticalCss(theme) }}></style>
      <link rel="stylesheet" href=${stylesheetUrl} />
      ${themeUrl && html`<link rel="stylesheet" href=${themeUrl} />`}
      <${Scripts} />
      ${
        share &&
        html`
          <meta property="og:site_name" content=${siteName} />
          <meta property="og:type" content=${share.type} />
          <meta property="og:title" content=${share.title} />
          <meta property="og:description" content=${share.description} />
          ${canonical && html`<meta property="og:url" content=${canonical} />`}
          <meta property="og:image" content=${`${origin}${share.image ?? previewImagePath}`} />
          <meta
            property="og:image:type"
            content=${(share.image && share.imageType) || 'image/png'}
          />
          <meta property="og:image:width" content=${String(previewImageSize.width)} />
          <meta property="og:image:height" content=${String(previewImageSize.height)} />
          <meta
            property="og:image:alt"
            content=${share.imageAlt ?? `${siteName}: ${siteDescription}`}
          />
          ${
            share.publishedTime &&
            html`<meta property="article:published_time" content=${share.publishedTime} />`
          }
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content=${share.title} />
          <meta name="twitter:description" content=${share.description} />
          <meta name="twitter:image" content=${`${origin}${share.image ?? previewImagePath}`} />
          ${share.themeColor && html`<meta name="theme-color" content=${share.themeColor} />`}
        `
      }
    </head>
  `
}

// The page's JavaScript, only when it is on for this visitor (src/javascript.ts); off,
// none of this is sent. The import map first, so it applies to every module after it (its
// exact text is allowed by hash in the CSP, src/middleware/security-headers.ts). Then
// preloads for main.ts and everything it imports, so the browser fetches them in parallel,
// and main.ts itself (a module, so it runs after the page is parsed). The page context as
// JSON for components rendered in the browser (src/client/page-context.ts): a data block,
// never run; `<` is escaped so no value can end the element.
function Scripts() {
  const context = usePageContext()
  if (!context.javascript) {
    return null
  }
  const json = JSON.stringify(context).replaceAll('<', '\\u003c')
  return html`
    <script type="importmap" dangerouslySetInnerHTML=${{ __html: importMapJson }}></script>
    ${mainModulePreloads.map((url) => html`<link rel="modulepreload" href=${url} />`)}
    <script type="module" src=${mainModuleUrl}></script>
    <script
      type="application/json"
      id=${pageContextElementId}
      dangerouslySetInnerHTML=${{ __html: json }}
    ></script>
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

type NavItem = { href: string; label: string; icon: IconName; current: boolean; badge?: number }

// Every destination, on every page, always visible: no menus to open. Logged-in viewers
// get their profile and settings; everyone else the way in.
function navItems({ viewer, isAdmin, path, unreadNotifications }: PageContext): NavItem[] {
  const item = (
    href: string,
    label: string,
    icon: IconName,
    current = path === href,
    badge?: number,
  ) => ({
    href,
    label,
    icon,
    current,
    badge,
  })
  if (!viewer) {
    return [
      item('/', 'Home', 'home'),
      item('/people', 'People', 'people'),
      item('/search', 'Search', 'search'),
      item('/login', 'Log in', 'login'),
      item('/signup', 'Sign up', 'personPlus'),
    ]
  }
  const profile = `/${viewer.username}/`
  return [
    item('/', 'Home', 'home'),
    item('/everyone', 'Everyone', 'globe'),
    item('/people', 'People', 'people'),
    item('/search', 'Search', 'search'),
    item('/near', 'Near', 'pin'),
    item(profile, 'Profile', 'person', path === profile || path === `/${viewer.username}/edit`),
    // Only while there is something to see, so the bar stays short on phones. The same
    // link is in Your corner, always.
    ...(unreadNotifications > 0
      ? [
          item(
            `/${viewer.username}/notifications/`,
            'Alerts',
            'bell',
            path.startsWith(`/${viewer.username}/notifications`),
            unreadNotifications,
          ),
        ]
      : []),
    item('/settings', 'Settings', 'sliders', path.startsWith('/settings')),
    ...(isAdmin ? [item('/admin', 'Admin', 'shield', path.startsWith('/admin'))] : []),
  ]
}

function TopNav() {
  const context = usePageContext()
  const { viewer } = context
  return html`
    <nav class="top-nav" aria-label="Main">
      ${navItems(context).map(
        ({ href, label, icon, current, badge }) =>
          html`<a href=${href} aria-current=${current ? 'page' : undefined}
            ><${Icon} name=${icon} /><span>${label}</span
            >${badge !== undefined && html`<${UnreadBadge} unread=${badge} />`}</a
          >`,
      )}
      ${
        viewer &&
        html`<form method="post" action="/api/logout" class="logout">
          <button type="submit" class="secondary">
            <${Icon} name="logout" /><span>Log out</span>
          </button>
        </form>`
      }
    </nav>
  `
}

// The frame of every page: the same header everywhere (site name, search and the
// navigation), then the page's own headline (`lead`, title, tagline and `actions`) at the top
// of the page, then <main>, with `aside` beside it on wide screens and under it on narrow ones.
// `lead` goes before the title (a profile's avatar). The home page's title is the site name,
// so it gets no second headline: the header's name is its <h1>.
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
  const isHome = title === siteName
  const name = isHome ? html`<h1>${siteName}</h1>` : html`<p class="site-name">${siteName}</p>`
  return html`
    <header class="site-head">
      <div class="brand-row">
        <div class="brand">
          <div>
            ${isHome ? name : html`<a href="/" class="site-name-link">${name}</a>`}
            <p class="tagline">${siteDescription}</p>
          </div>
        </div>
        ${search && html`<div class="head-actions"><${SiteSearch} /></div>`}
      </div>
      <${TopNav} />
    </header>
    ${
      !isHome &&
      html`<div class="page-title">
        ${lead}
        <div class="page-title-text">
          <h1>${title}</h1>
          ${tagline && html`<p class="tagline">${tagline}</p>`}
        </div>
        ${actions && html`<div class="head-actions">${actions}</div>`}
      </div>`
    }
    <div class=${aside ? 'layout' : 'layout single'}>
      <main>${children}</main>
      ${aside && html`<aside>${aside}</aside>`}
    </div>
  `
}

// The last link turns the site's optional JavaScript off or on (src/javascript.ts), on
// the page that has the setting.
function Footer() {
  const { viewer, javascript } = usePageContext()
  return html`
    <footer>
      <nav aria-label="About this site">
        <a href="/">blurt.trade</a> · <a href="/about">About</a> ·
        <a href="/terms">Terms</a>${' · '}<a href="/privacy">Privacy</a>${' · '}<a
          href=${javascriptSettingPath(viewer !== null)}
          >Turn JavaScript ${javascript ? 'off' : 'on'}</a
        >
      </nav>
    </footer>
  `
}

// The doctype is added here as a string: htm has no syntax for it, and inside a template
// it would come out as the text "!doctype html" in the body. The request's page context
// goes in at the root, so every component below reads it with usePageContext().
export function renderDocument(page: ComponentChildren, meta: PageMeta = {}): string {
  return (
    '<!doctype html>' +
    renderToString(
      html`
        <${PageContextValue.Provider} value=${pageContext()}>
          <html lang="en">
            <${Head} meta=${meta} />
            <body>
              <div class="shell">${page} <${Footer} /></div>
            </body>
          </html>
        <//>
      ` as VNode,
    ) // one root element, so never an array
  )
}
