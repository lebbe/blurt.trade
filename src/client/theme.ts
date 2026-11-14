import { isTheme, themeStylesheetUrl, type ThemeId } from '../shared/themes.ts'
import type { PageContext } from '../ui/context.ts'
import { updatePageContext } from './page-context.ts'

// Switches the page to another theme without loading it again, after the theme form
// saved it (src/client/autosave.ts). A theme is style.css plus, for all but the default,
// one stylesheet linked after it (src/shared/themes.ts), so this swaps that <link>: the new
// one goes in first and the old one comes out once the new one has loaded, so the page
// never flashes the default colours in between.
//
// The critical <style> in <head> stays the old theme's (its text is allowed by hash in the
// CSP, and it is only there for the first paint). Nothing of it shows afterwards: the
// stylesheets set everything it does, the root's background and colour included (from the
// theme's variables, public/style.css), so the page looks exactly as if loaded in the new
// theme.

const themeLinkSelector = 'link[rel=stylesheet][href^="/static/themes/"]'

export function applyTheme(theme: unknown, page: PageContext, doc: Document = document): void {
  if (!isTheme(theme) || theme === page.theme) {
    return
  }
  const old = [...doc.querySelectorAll<HTMLLinkElement>(themeLinkSelector)]
  const url = themeStylesheetUrl(theme as ThemeId)
  if (url) {
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    const removeOld = () => old.forEach((element) => element.remove())
    link.addEventListener('load', removeOld, { once: true })
    // Not loaded (offline?): the new theme isn't there to show, so keep the old one.
    link.addEventListener('error', () => link.remove(), { once: true })
    const base = old.at(-1) ?? doc.querySelector('link[rel=stylesheet][href="/static/style.css"]')
    if (base) {
      base.after(link)
    } else {
      doc.head.append(link)
    }
  } else {
    old.forEach((element) => element.remove())
  }
  updatePageContext(page, { theme: theme as ThemeId }, doc)
}
