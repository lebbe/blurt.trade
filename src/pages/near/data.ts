import type { AuthenticatedUser } from '../../middleware/auth.ts'
import type { FeedItem } from '../../routes/state.ts'
import type { GeoPoint } from '../../shared/geo.ts'

// Blurts near you (/near): the data the pages are rendered from. The route fetches it once;
// it goes out as JSON as is, as HTML through near.html.ts and as Markdown through
// near.md.ts (see src/negotiate.ts).

// "Blurts near you". `location` is the viewer's own (null if not set: then no blurts).
// `radius` is in km, one of `radii`. `next` is the cursor for older blurts.
export type NearData = {
  viewer: AuthenticatedUser
  location: GeoPoint | null
  radius: number
  radii: number[]
  blurts: FeedItem[]
  next: string | null
}
