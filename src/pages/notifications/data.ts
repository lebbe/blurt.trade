import type { AuthenticatedUser } from '../../middleware/auth.ts'
import type { Notification } from '../../routes/state/notifications.ts'
import type { PushDevice } from '../../ui/push.ts'

// The notifications page (/:username/notifications): the data the pages are rendered from.
// The route fetches it once; it goes out as JSON as is, as HTML through
// notifications.html.ts and as Markdown through notifications.md.ts (see src/negotiate.ts).

// /:username/notifications/, the owner's only: the unread ones, or with `read` the read
// ones, newest first. `unread` is the unread count (at most unreadCap). `next` is the
// cursor for the page after this one. `push` (the unread page only, when this server sends
// pushes) is for offering push notifications on this device.
export type NotificationsData = {
  viewer: AuthenticatedUser
  read: boolean
  unread: number
  notifications: Notification[]
  next: string | null
  push?: PushDevice
}
