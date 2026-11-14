import type { ComponentChildren } from 'preact'
import {
  outsidePageContext,
  pageContextElementId,
  PageContextValue,
  type PageContext,
} from '../ui/context.ts'
import { html } from '../ui/html.ts'

// The page context in the browser. The server puts the one it rendered the page with
// into the page as JSON (<script type="application/json" id="page-context">: data, never
// run, so the CSP needs nothing for it), and components rendered here read it the same
// way as on the server, with usePageContext(), inside a PageContextProvider.

// Missing or unreadable (it shouldn't be): the context of no request, anonymous.
export function readPageContext(doc: Document = document): PageContext {
  const text = doc.getElementById(pageContextElementId)?.textContent
  if (!text) {
    return outsidePageContext
  }
  try {
    return { ...outsidePageContext, ...(JSON.parse(text) as Partial<PageContext>) }
  } catch {
    return outsidePageContext
  }
}

// Wrap what an island renders, so shared components (src/ui) see the page context:
//   render(html`<${PageContextProvider} value=${context.page}><${BlurtCard} … /><//>`, el)
export function PageContextProvider({
  value,
  children,
}: {
  value: PageContext
  children?: ComponentChildren
}) {
  return html`<${PageContextValue.Provider} value=${value}>${children}<//>`
}

// After a setting changed without a page load (theme, time zone): the same change to the
// context enhancers were given and to the JSON in the page, so everything that reads it
// later (other enhancers, islands rendered from then on) sees the page as it now is.
export function updatePageContext(
  page: PageContext,
  changes: Partial<PageContext>,
  doc: Document = document,
): void {
  Object.assign(page, changes)
  const element = doc.getElementById(pageContextElementId)
  if (element) {
    element.textContent = JSON.stringify(page).replaceAll('<', '\\u003c')
  }
}
