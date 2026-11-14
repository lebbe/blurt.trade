import type { CardColorId } from '../../card-colors.ts'
import type { Blurt } from '../../routes/state/blurts.ts'
import type { Viewer } from '../../ui/context.ts'

// A blurt page (/:username/:id) and its thread: the data the pages are rendered from. The
// route fetches it once; it goes out as JSON as is, as HTML through blurt.html.ts and as
// Markdown through blurt.md.ts (see src/negotiate.ts).

// `reported`: whether the viewer has reported `blurt` (false for anonymous viewers).
export type BlurtPageData = {
  viewer: Viewer
  blurt: Blurt
  parent: Blurt | null
  reported: boolean
  replies: Blurt[]
  next: string | null // for replies
  related: Blurt[]
  // The author's card colour, for the share image (null: the default).
  cardColor?: CardColorId | null
}
