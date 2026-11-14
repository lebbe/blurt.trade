import type { Person } from '../../routes/state.ts'
import type { Viewer } from '../../ui/context.ts'

// Everyone on the site (/people): the data the pages are rendered from. The route fetches
// it once; it goes out as JSON as is, as HTML through people.html.ts and as Markdown
// through people.md.ts (see src/negotiate.ts).

// /people: everyone, alphabetically. `next` is the cursor (the last username, in lower
// case) for the following page.
export type PeopleData = {
  viewer: Viewer
  people: Person[]
  next: string | null
}
