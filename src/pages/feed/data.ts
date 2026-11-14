import type { FeedItem } from '../../routes/state/blurts.ts'
import type { Viewer } from '../../ui/context.ts'
import type { DiscoverySection } from '../../ui/discovery.ts'

// The feed pages (/ and /everyone): the data the pages are rendered from. The route fetches
// it once; it goes out as JSON as is, as HTML through feed.html.ts and as Markdown through
// feed.md.ts (see src/negotiate.ts).

// `feed` says which feed `blurts` is. `hasFollowingFeed` is whether the viewer follows
// enough accounts to get the following feed at `/` (and tabs between the two).
// `followedBlurts` are the latest from followed accounts, shown on top of the everyone
// feed until then. `discovery` is mixed in between `blurts`, on the first page only.
// `next` is the cursor for the page after this one, or null on the last.
export type FeedData = {
  viewer: Viewer
  feed: 'following' | 'everyone'
  hasFollowingFeed: boolean
  followedBlurts: FeedItem[]
  blurts: FeedItem[]
  discovery: DiscoverySection[]
  next: string | null
}

// Where the feed in `data` lives, for its "Older blurts" link.
export function feedPath({ feed, hasFollowingFeed }: FeedData): string {
  return feed === 'everyone' && hasFollowingFeed ? '/everyone' : '/'
}
