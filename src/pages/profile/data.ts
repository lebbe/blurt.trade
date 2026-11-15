import type { Blurt } from '../../routes/state/blurts.ts'
import type { FollowStats } from '../../routes/state/follows.ts'
import type { UserProfile } from '../../routes/state/profiles.ts'
import type { InviteCode } from '../../routes/state/signup.ts'
import type { Viewer } from '../../ui/context.ts'

// A profile page (/:username/): the data the pages are rendered from. The route fetches it
// once; it goes out as JSON as is, as HTML through profile.html.ts and as Markdown through
// profile.md.ts (see src/negotiate.ts).

// `invitedBy` is the username of whoever invited them (null if nobody did).
// `inviteCodes` are the profile's own codes, only for its owner and only while sign-up needs
// an invite code (null otherwise). `botOwners`: who runs the bot, by username (null for a
// person).
export type ProfilePageData = {
  viewer: Viewer
  profile: UserProfile
  invitedBy: string | null
  inviteCodes: InviteCode[] | null
  follows: FollowStats
  blurts: Blurt[]
  next: string | null
  botOwners: string[] | null
}
