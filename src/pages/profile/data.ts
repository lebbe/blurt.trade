import type { Blurt, FollowStats, InviteCode, UserProfile } from '../../routes/state.ts'
import type { Viewer } from '../../ui/context.ts'

// A profile page (/:username/): the data the pages are rendered from. The route fetches it
// once; it goes out as JSON as is, as HTML through profile.html.ts and as Markdown through
// profile.md.ts (see src/negotiate.ts).

// `invitedBy` is the username of whoever invited them (null if nobody did).
// `inviteCodes` are the profile's own codes, only for its owner and only while sign-up needs
// an invite code (null otherwise).
export type ProfilePageData = {
  viewer: Viewer
  profile: UserProfile
  invitedBy: string | null
  inviteCodes: InviteCode[] | null
  follows: FollowStats
  blurts: Blurt[]
  next: string | null
}
