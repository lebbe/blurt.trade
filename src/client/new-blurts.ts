import { ListItem } from '../ui/lists.ts'
import { html } from '../ui/html.ts'
import { plural } from '../ui/text.ts'
import type { FeedItem } from '../routes/state/blurts.ts'
import { announce } from './announce.ts'
import type { EnhancerContext } from './enhance.ts'
import { withDates } from './json.ts'
import type { LiveBlurt } from './live.ts'
import { renderNodes } from './render.ts'
import { followLink } from './requests.ts'

// <section data-enhance="new-blurts" data-feed="everyone|following" data-feed-path="/">:
// the feed's list, on its first page. Blurts posted by others since the page loaded
// (`live:blurts` from ./live.ts) are counted in a banner at the top, "3 new blurts", and
// only put into the list when it is clicked: a list that moves by itself while you read
// it is worse than one that says there is more. A click fetches the feed's first page as
// JSON and puts the blurts newer than the ones shown at the top, with the same cards the
// server renders (ListItem, as ./more.ts does for older pages), then moves the focus to
// the first of them. The banner sits under the list's heading, and blurts posted from
// this page go under it too (./composer.ts).

type FeedPage = { blurts?: FeedItem[] }

export function enhance(section: HTMLElement, context: EnhancerContext): void {
  const feed = section.dataset.feed === 'following' ? 'following' : 'everyone'
  const path = section.dataset.feedPath ?? '/'
  // Older pages (?before=) aren't the top of anything.
  if (new URL(location.href).searchParams.has('before')) {
    return
  }
  const waiting = new Set<number>()
  const card = (id: number) => section.querySelector<HTMLElement>(`:scope > article#blurt-${id}`)
  const onPage = (id: number) => card(id) !== null
  // Shown since the page loaded or the last click, so not where the server would put it:
  // blurts posted from this page (./composer.ts), which go on top.
  const listed = (id: number) => {
    const shown = card(id)
    return shown !== null && shown.dataset.posted === undefined
  }

  const banner = document.createElement('div')
  banner.className = 'new-blurts'
  banner.setAttribute('role', 'status')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'secondary'
  button.hidden = true
  banner.append(button)
  section.querySelector(':scope > h2')?.after(banner)

  const show = () => {
    button.hidden = waiting.size === 0
    button.textContent = plural(waiting.size, 'new blurt', 'new blurts')
  }

  document.addEventListener('live:blurts', (event) => {
    for (const blurt of (event as CustomEvent<LiveBlurt[]>).detail) {
      if (blurt[feed] && !onPage(blurt.id)) {
        waiting.add(blurt.id)
      }
    }
    show()
  })

  let loading = false
  button.addEventListener('click', async () => {
    if (loading) {
      return
    }
    loading = true
    section.setAttribute('aria-busy', 'true')
    const url = new URL(path, location.href)
    url.searchParams.set('pictures', 'none')
    const outcome = await followLink<FeedPage>(url.href, { fallback: false })
    section.removeAttribute('aria-busy')
    loading = false
    const items = outcome.kind === 'success' ? outcome.data?.blurts : undefined
    if (!Array.isArray(items)) {
      location.assign(path) // what a reload would show
      return
    }
    // The ones above the newest blurt already on the page (all of them, for a list that
    // was empty). When none of the page's blurts is on the first page any more, there are too many new ones to put on top
    // without a gap: the page itself, fresh, is what to show.
    const firstShown = items.findIndex((item) => listed(item.id))
    const anyListed = section.querySelector(':scope > article:not([data-posted])') !== null
    if (firstShown === -1 && anyListed) {
      location.assign(path)
      return
    }
    const fresh = withDates(firstShown === -1 ? items : items.slice(0, firstShown))
    // Posted from this page meanwhile: drawn again here, in order among the others.
    for (const item of fresh) {
      card(item.id)?.remove()
    }
    const nodes = fresh.flatMap((item) =>
      renderNodes(
        html`<${ListItem} kind="feed" item=${item} viewer=${context.page.viewer} />`,
        context.page,
      ),
    )
    section.querySelector(':scope > p.empty')?.remove()
    banner.after(...nodes)
    waiting.clear()
    show()
    const elements = nodes.filter((node) => node instanceof HTMLElement)
    await Promise.all(elements.map((node) => context.enhance(node)))
    announce(`${plural(fresh.length, 'new blurt', 'new blurts')} shown`)
    if (elements[0]) {
      elements[0].tabIndex = -1
      elements[0].focus()
    }
  })
}
