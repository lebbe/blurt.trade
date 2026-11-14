import type { NotificationSettings, UserProfile } from '../../routes/state.ts'
import type { GeoPoint } from '../../shared/geo.ts'
import type { Viewer } from '../../ui/context.ts'

// The edit page (/:username/edit): the data the pages are rendered from. The route fetches
// it once; it goes out as JSON as is, as HTML through profile-edit.html.ts and as Markdown
// through profile-edit.md.ts (see src/negotiate.ts).

// `location` is the owner's coarse location (null if not set). The edit page is the only
// profile page that has it.
export type ProfileEditData = {
  viewer: Viewer
  profile: UserProfile
  location: GeoPoint | null
  // Which notifications they want; private, like the location.
  notifications: NotificationSettings
}
