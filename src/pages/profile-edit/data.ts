import type { NotificationSettings } from '../../routes/state/notifications.ts'
import type { UserProfile } from '../../routes/state/profiles.ts'
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
  // Push notifications (src/push.ts); missing when this server doesn't send them.
  push?: PushSettings
}

// `publicKey` is the server's VAPID key, which a browser subscribes with. `thisDevice` are
// the endpoints this login has (src/client/push.ts compares the browser's with them), and
// `devices` how many of the user's browsers get pushes in all.
export type PushSettings = {
  publicKey: string
  thisDevice: string[]
  devices: number
}
