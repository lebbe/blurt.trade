import type { Notification, NotificationKind } from '../routes/state.ts'
import { AvatarView } from './avatar.ts'
import { Timestamp } from './blurt-card.ts'
import { SubmitButton } from './forms.ts'
import { html } from './html.ts'
import { preview } from './text.ts'

// What each kind says, as the actor's action: "Ada replied to your blurt". Reblurts and
// quotes are separate rows with their own wording, and share one setting.
export const notificationVerbs: Record<NotificationKind, string> = {
  followed_blurt: 'blurted',
  reply: 'replied to your blurt',
  reblurt: 'reblurted your blurt',
  quote: 'quoted your blurt',
}

// "32", or "99+" past the cap (unreadCap in src/routes/state.ts): the notification count.
export function unreadLabel(unread: number): string {
  return unread > 99 ? '99+' : String(unread)
}

// The count as a small pill in the theme's --warn colour. Screen readers get "3 unread"
// instead of the bare number.
export function UnreadBadge({ unread }: { unread: number }) {
  return html`<span class="badge" aria-hidden="true">${unreadLabel(unread)}</span
    ><span class="visually-hidden">${unreadLabel(unread)} unread</span>`
}

// A line per notification, linking to the blurt and the actor's profile.
export function NotificationItem({ notification }: { notification: Notification }) {
  const { kind, actor, avatar, blurtId, blurtUsername, text, createdAt, read, id } = notification
  return html`
    <article class=${read ? 'blurt notification' : 'blurt notification unread'}>
      <div class="blurt-main">
        <${AvatarView} avatar=${avatar} />
        <div class="blurt-body">
          <div class="blurt-meta">
            <strong><a href="/${actor}/">${actor}</a></strong>
            <span>${notificationVerbs[kind]}</span>
            <a href="/${blurtUsername}/${blurtId}"><${Timestamp} date=${createdAt} /></a>
          </div>
          ${text !== null && html`<p><a href="/${blurtUsername}/${blurtId}">${preview(text, 140)}</a></p>`}
        </div>
      </div>
      ${
        !read &&
        html`<div class="blurt-footer">
          <form method="post" action="/api/notifications/read" class="blurt-actions">
            <input type="hidden" name="id" value=${id} />
            <${SubmitButton} icon="check" label="Mark as read" kind="secondary" />
          </form>
        </div>`
      }
    </article>
  `
}
