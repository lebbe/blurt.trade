import { isTheme, themeColor, themes, themeStylesheetUrl, type ThemeId } from '../shared/themes.ts'
import type { PageContext } from '../ui/context.ts'
import type { LiveForm } from './autosave.ts'
import { updatePageContext } from './page-context.ts'

// Switches the page to another theme without loading it again, as soon as one is picked on
// the edit page (src/client/autosave.ts saves the pick meanwhile). A theme is style.css
// plus, for all but the default, one stylesheet linked after it (src/shared/themes.ts), so
// this swaps that <link>: the new one goes in first and the old one comes out once the new
// one has loaded, so the page never flashes the default colours in between.
//
// The critical <style> in <head> stays the old theme's (its text is allowed by hash in the
// CSP, and it is only there for the first paint). Nothing of it shows afterwards: the
// stylesheets set everything it does, the root's background and colour included (from the
// theme's variables, public/style.css), so the page looks exactly as if loaded in the new
// theme.

// The stylesheet links the theme is made of, not the warmed-up ones (warmThemes).
const themeLinkSelector = 'link[rel=stylesheet][href^="/static/themes/"]:not([data-warm])'

// The link of a switch still loading. A newer switch drops it, so a slow stylesheet can
// never land on top of a theme picked after it.
let loading: HTMLLinkElement | null = null

export function applyTheme(theme: unknown, page: PageContext, doc: Document = document): void {
  if (!isTheme(theme) || theme === page.theme) {
    return
  }
  loading?.remove()
  loading = null
  const old = [...doc.querySelectorAll<HTMLLinkElement>(themeLinkSelector)]
  const url = themeStylesheetUrl(theme)
  if (url) {
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.addEventListener(
      'load',
      () => {
        if (loading === link) {
          loading = null
          old.forEach((element) => element.remove())
        }
      },
      { once: true },
    )
    // Not loaded (offline?): the new theme isn't there to show, so keep the old one.
    link.addEventListener(
      'error',
      () => {
        if (loading === link) {
          loading = null
        }
        link.remove()
      },
      { once: true },
    )
    loading = link
    const base = old.at(-1) ?? doc.querySelector('link[rel=stylesheet][href="/static/style.css"]')
    if (base) {
      base.after(link)
    } else {
      doc.head.append(link)
    }
  } else {
    // The default is style.css itself, which is always there: nothing to wait for.
    old.forEach((element) => element.remove())
  }
  // The browser's colour around the page, unless the page asked for its own (a shared
  // blurt's, src/pages/shared/layout.ts).
  const meta = doc.querySelector<HTMLMetaElement>('meta[name=theme-color]')
  if (meta && meta.content === themeColor(page.theme)) {
    meta.content = themeColor(theme)
  }
  updatePageContext(page, { theme }, doc)
}

// Fetches every other theme's stylesheet in the background, so picking one shows it at
// once: the switch's <link> finds it in the page's cache. A stylesheet whose media matches
// nothing is still downloaded (at the lowest priority, without holding up the page) but
// never applies. Not <link rel="prefetch">: the CSP only governs that with default-src,
// which is 'none' here, so browsers that follow the spec would refuse it; style-src
// 'self' allows these. Four small files (about 1 kB each).
export function warmThemes(page: PageContext, doc: Document = document): void {
  for (const { id } of themes) {
    const url = themeStylesheetUrl(id)
    if (!url || id === page.theme || doc.querySelector(`link[data-warm][href="${url}"]`)) {
      continue
    }
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.media = 'not all'
    link.href = url
    link.dataset.warm = ''
    doc.head.append(link)
  }
}

// The theme form on the edit page, for autosave: the picked theme shows at once, before it
// is saved, and the saved one comes back if saving fails.
export function liveThemeForm(form: HTMLFormElement, page: PageContext): LiveForm {
  let saved: ThemeId = page.theme
  const picked = () => (form.elements.namedItem('theme') as RadioNodeList | null)?.value
  warmThemes(page)
  return {
    show: () => applyTheme(picked(), page),
    saved: (data) => {
      if (isTheme(data?.theme)) {
        saved = data.theme
      }
    },
    revert: () => {
      const radio = form.querySelector<HTMLInputElement>(`input[name=theme][value="${saved}"]`)
      if (radio) {
        radio.checked = true
      }
      applyTheme(saved, page)
    },
  }
}
