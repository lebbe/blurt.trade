import { type ListKind, ListItem, listKeys, loadedLabel } from '../ui/lists.ts'
import { html } from '../ui/html.ts'
import { announce } from './announce.ts'
import type { EnhancerContext } from './enhance.ts'
import { withDates } from './json.ts'
import { renderNodes } from './render.ts'
import { followLink } from './requests.ts'

// <p class="next-page" data-enhance="more" data-list="…">: endless scrolling. When the
// "Older blurts" link (NextPageLink, src/pages/shared/components.ts) comes near the bottom
// of the screen, the page it links to is fetched as JSON and its items are rendered here,
// with the same components the server uses (ListItem, src/ui/lists.ts), above the link,
// which then points at the page after that. The link stays a link: for screen readers,
// for a middle click, and as the fallback when anything goes wrong.
//
//   - After `autoPages` pages loaded by scrolling, it stops, so the footer (About, Terms,
//     Privacy) can be reached. The link then loads the next page in place when clicked,
//     and scrolling takes over again for as many pages.
//   - The address bar follows the page being read (history.replaceState with its cursor),
//     so a reload, or Back to here without the back/forward cache, starts at that page.
//   - The list is aria-busy while a page loads; the live region says "100 older blurts
//     loaded". A page loaded by a click (or Enter) moves the focus to its first item.
//   - When loading fails, scrolling stops and the link is an ordinary link again: a click
//     goes to the page, as without JavaScript.

const autoPages = 3
// How far below the screen the link may still be when the next page is fetched.
const lookAhead = '0px 0px 800px 0px'

// Where a list's items go: into its <ul> or the thread's replies, else just above the link.
function placeItems(kind: ListKind, element: HTMLElement, nodes: ChildNode[]): void {
  const section = element.closest('section')
  if (kind === 'people') {
    const list = section?.querySelector('ul.people')
    if (list) {
      list.append(...nodes)
      return
    }
  }
  if (kind === 'replies') {
    const replies = section?.querySelector('.thread-children')
    if (replies) {
      // Before the replies posted from this page (src/client/composer.ts): they are newer.
      const posted = replies.querySelector(':scope > [data-posted]')
      if (posted) {
        posted.before(...nodes)
      } else {
        replies.append(...nodes)
      }
      return
    }
  }
  element.before(...nodes)
}

// The link's URL with the next cursor in place of its own (`after` for people and
// replies, `before` for everything else).
function nextUrl(href: string, next: string): string {
  const url = new URL(href)
  url.searchParams.set(url.searchParams.has('after') ? 'after' : 'before', next)
  return url.href
}

// What the script fetches: the same page, with pictures as plain URLs (the cards only link
// to /pictures/{id}.svg; the drawing's data would be dead weight, src/picture-json.ts).
function jsonUrl(href: string): string {
  const url = new URL(href)
  url.searchParams.set('pictures', 'none')
  return url.href
}

type PageData = Record<string, unknown> & { next?: string | null }

export function enhance(element: HTMLElement, context: EnhancerContext): void {
  const kind = element.dataset.list as ListKind
  const link = element.querySelector<HTMLAnchorElement>('a[rel=next]')
  if (!link || !Object.hasOwn(listKeys, kind)) {
    throw new Error('Not a next page link')
  }
  const busy = element.closest('section') ?? element.parentElement ?? element
  const start = location.href
  // The first item of each page loaded here, and that page's URL, for the address bar.
  const pages: { first: Element; url: string }[] = []
  let left = autoPages
  let loading = false

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void load(false)
      }
    },
    { rootMargin: lookAhead },
  )
  // Observing again reports the link's current state, so a page too short to push the
  // link off the screen loads the next one too.
  const watch = () => {
    observer.unobserve(element)
    if (left > 0) {
      observer.observe(element)
    }
  }

  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    void load(true)
  })

  async function load(clicked: boolean): Promise<void> {
    if (loading || (!clicked && left <= 0) || !link) {
      return
    }
    loading = true
    busy.setAttribute('aria-busy', 'true')
    element.dataset.loading = ''
    const url = link.href
    const outcome = await followLink<PageData>(jsonUrl(url), { fallback: false })
    busy.removeAttribute('aria-busy')
    delete element.dataset.loading
    loading = false
    const data = outcome.kind === 'success' ? outcome.data : null
    const items = data?.[listKeys[kind]]
    if (!data || !Array.isArray(items)) {
      observer.disconnect()
      left = 0
      if (clicked) {
        location.assign(url) // what the link does without JavaScript
      }
      return
    }

    const nodes = withDates(items).flatMap((item) =>
      renderNodes(
        html`<${ListItem} kind=${kind} item=${item} viewer=${context.page.viewer} />`,
        context.page,
      ),
    )
    placeItems(kind, element, nodes)
    const elements = nodes.filter((node) => node instanceof HTMLElement)
    if (elements[0]) {
      pages.push({ first: elements[0], url })
    }
    await Promise.all(elements.map((node) => context.enhance(node)))
    announce(loadedLabel(kind, items.length))

    left = clicked ? autoPages : left - 1
    if (data.next) {
      link.href = nextUrl(url, data.next)
      watch()
    } else {
      observer.disconnect()
      element.remove()
    }
    if (clicked && elements[0]) {
      elements[0].tabIndex = -1
      elements[0].focus()
    }
    track()
  }

  // The address bar shows the last loaded page whose first item is above the middle of the
  // screen (the page's own URL above all of them). history.state is kept as it is.
  function track(): void {
    let url = start
    for (const page of pages) {
      if (page.first.isConnected && page.first.getBoundingClientRect().top < innerHeight / 2) {
        url = page.url
      }
    }
    if (url !== location.href) {
      history.replaceState(history.state, '', url)
    }
  }
  let frame = 0
  addEventListener(
    'scroll',
    () => {
      if (pages.length > 0 && frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0
          track()
        })
      }
    },
    { passive: true },
  )

  watch()
}
