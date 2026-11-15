import { h } from 'preact'
import type { NotificationsData } from './data.ts'
import { LinkPanel, NextPageLink, SupportLinks } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { SubmitButton } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { NotificationItem, UnreadBadge } from '../../ui/notifications.ts'
import { PushDeviceButton } from '../../ui/push.ts'
import { notificationsPath } from '../../ui/urls.ts'

function NotificationsPage({ viewer, read, unread, notifications, next, push }: NotificationsData) {
  const here = (before?: string) => notificationsPath(viewer.username, { read, before })
  return html`
    <${Page}
      title="Notifications"
      tagline=${read ? 'The ones you have read.' : 'What happened to you and the people you follow.'}
      aside=${html`
        <${LinkPanel}
          title="Notifications"
          links=${[
            [
              notificationsPath(viewer.username),
              unread > 0 ? html`Unread <${UnreadBadge} unread=${unread} />` : 'Unread',
            ],
            [notificationsPath(viewer.username, { read: true }), 'Already read'],
            [`/${viewer.username}/edit#notifications`, 'Choose what you get'],
          ]}
        />
        <${SupportLinks} />
      `}
    >
      ${push && html`<${PushDeviceButton} push=${push} offer />`}
      <section aria-label="Notifications" class="panel">
        <h2>${read ? 'Read' : 'Unread'}</h2>
        ${
          !read &&
          unread > 0 &&
          html`<form method="post" action="/api/notifications/read">
            <div class="actions">
              <${SubmitButton} icon="check" label="Mark all as read" kind="secondary" />
            </div>
          </form>`
        }
        ${
          notifications.length > 0
            ? notifications.map(
                (notification) => html`<${NotificationItem} notification=${notification} />`,
              )
            : html`<p class="empty">
                ${read ? 'Nothing read yet.' : 'Nothing new. You are all caught up.'}
              </p>`
        }
        ${
          next &&
          html`<${NextPageLink}
            href=${here(next)}
            label="Older notifications"
            list="notifications"
          />`
        }
      </section>
    <//>
  `
}

export function renderNotificationsPage(data: NotificationsData): string {
  return renderDocument(h(NotificationsPage, data), { title: 'Notifications', noindex: true })
}
