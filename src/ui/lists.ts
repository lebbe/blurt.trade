import type { Blurt, FeedItem } from '../routes/state/blurts.ts'
import type { Notification } from '../routes/state/notifications.ts'
import type { Person } from '../routes/state/profiles.ts'
import { BlurtCard } from './blurt-card.ts'
import type { Viewer } from './context.ts'
import { html } from './html.ts'
import { NotificationItem } from './notifications.ts'
import { PersonItem } from './people.ts'
import { plural } from './text.ts'

// The paged lists, and how one item of each is shown: the same components, with the same
// props, as the pages use (src/pages/*/), so the next page the browser renders from JSON
// (src/client/more.ts) is the markup the server would have sent for it.
//
//   feed           /, /everyone, /near: top-level blurts with their latest replies
//   blurts         /:username/, /search: blurts on their own
//   replies        a thread's replies (/:username/:id, "More replies")
//   people         /people
//   notifications  /:username/notifications/
export type ListKind = 'feed' | 'blurts' | 'replies' | 'people' | 'notifications'

// Where each list's items are in the page's JSON (src/pages/*/data.ts). Every one of
// those also has `next`, the cursor for the page after it.
export const listKeys = {
  feed: 'blurts',
  blurts: 'blurts',
  replies: 'replies',
  people: 'people',
  notifications: 'notifications',
} as const satisfies Record<ListKind, string>

// What a page of each list is called when it is announced: "100 older blurts loaded".
export const listNouns: Record<ListKind, [one: string, many: string]> = {
  feed: ['older blurt', 'older blurts'],
  blurts: ['older blurt', 'older blurts'],
  replies: ['more reply', 'more replies'],
  people: ['more person', 'more people'],
  notifications: ['older notification', 'older notifications'],
}

export function loadedLabel(kind: ListKind, count: number): string {
  const [one, many] = listNouns[kind]
  return `${plural(count, one, many)} loaded`
}

export function ListItem({
  kind,
  item,
  viewer,
}: {
  kind: ListKind
  item: unknown
  viewer: Viewer
}) {
  switch (kind) {
    case 'feed': {
      const blurt = item as FeedItem
      return html`<${BlurtCard} blurt=${blurt} viewer=${viewer} replies=${blurt.replies} />`
    }
    case 'blurts':
      return html`<${BlurtCard} blurt=${item as Blurt} viewer=${viewer} />`
    case 'replies':
      return html`<${BlurtCard} blurt=${item as Blurt} viewer=${viewer} inThread />`
    case 'people':
      return html`<${PersonItem} person=${item as Person} />`
    case 'notifications':
      return html`<${NotificationItem} notification=${item as Notification} />`
  }
}
