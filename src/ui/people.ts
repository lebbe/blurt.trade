import type { Person } from '../routes/state/profiles.ts'
import { AvatarView } from './avatar.ts'
import { Timestamp } from './blurt-card.ts'
import { html } from './html.ts'
import { plural, preview } from './text.ts'

// One row of /people. Here, not in the page, because the browser renders the next page
// of the list with it too (src/client/more.ts).
export function PersonItem({ person }: { person: Person }) {
  return html`<li>
    <a href="/${person.username}/" class="person-avatar"
      ><${AvatarView} avatar=${person.avatar}
    /></a>
    <div class="person-body">
      <strong><a href="/${person.username}/">${person.username}</a></strong>
      <span class="tiny"
        >${plural(person.blurtCount, 'blurt')} · ${plural(person.followerCount, 'follower')}</span
      >
      ${person.bio !== '' && html`<p class="tiny">${preview(person.bio, 120)}</p>`}
      <span class="tiny"
        >Joined <${Timestamp} date=${person.joinedAt} />${
          person.lastBlurtAt && html` · Last blurt <${Timestamp} date=${person.lastBlurtAt} />`
        }</span
      >
    </div>
  </li>`
}
