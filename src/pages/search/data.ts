import type { Blurt, UserMatch } from '../../routes/state.ts'
import type { Viewer } from '../../ui/context.ts'

// Search (/search): the data the pages are rendered from. The route fetches it once; it
// goes out as JSON as is, as HTML through search.html.ts and as Markdown through
// search.md.ts (see src/negotiate.ts).

// /search: `query` as searched for ('' before a search), matching users (first page only)
// and blurts, newest first. `next` is the cursor for older matching blurts.
export type SearchData = {
  viewer: Viewer
  query: string
  users: UserMatch[]
  blurts: Blurt[]
  next: string | null
}
