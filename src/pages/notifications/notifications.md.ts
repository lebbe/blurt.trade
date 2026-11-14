import type { NotificationsData } from './data.ts'
import { home } from '../shared/blurts.md.ts'
import { code, link, type Markdown, md } from '../shared/markdown.ts'
import { notificationVerbs } from '../../ui/notifications.ts'
import { notificationsPath } from '../../ui/urls.ts'

// The notifications page (/:username/notifications) as Markdown: the same data as the HTML,
// for text/markdown and text/plain clients (curl, LLMs, terminals). Forms are described
// instead of rendered.

export function notificationsMarkdown({
  viewer,
  read,
  unread,
  notifications,
  next,
}: NotificationsData): Markdown {
  return md`
    # Notifications

    ${home}

    ${read ? 'Notifications you have read' : `${unread >= 100 ? '99+' : unread} unread`}, newest first.
    ${link(read ? 'Unread' : 'Already read', notificationsPath(viewer.username, { read: !read }))} ·
    ${link('Choose what you get', `/${viewer.username}/edit#notifications`)}

    ${
      !read &&
      unread > 0 &&
      md`Send ${code('POST /api/notifications/read')} to mark all as read, or with ${code('id')} to mark one.`
    }

    ${
      notifications.length > 0
        ? notifications.map(
            (notification) =>
              md`- ${link(notification.actor, `/${notification.actor}/`)} ${notificationVerbs[notification.kind]}, ${link(notification.createdAt, `/${notification.blurtUsername}/${notification.blurtId}`)}${notification.read ? '' : ' (unread, id ' + notification.id + ')'}: ${notification.text}`,
          )
        : 'Nothing here.'
    }

    ${next && link('Older notifications', notificationsPath(viewer.username, { read, before: next }))}
  `
}
