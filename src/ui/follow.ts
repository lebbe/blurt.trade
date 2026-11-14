import type { FollowStats } from '../routes/state/follows.ts'
import { html } from './html.ts'
import { Icon } from './icons.ts'
import { plural } from './text.ts'

// Follow / Unfollow on a profile. A plain form; with JavaScript, src/client/follow.ts sends
// it with fetch() and renders it again from the answer (the new follow stats).
export function FollowForm({ username, following }: { username: string; following: boolean }) {
  return html`
    <form
      method="post"
      action=${following ? '/api/unfollow' : '/api/follow'}
      class="follow-form"
      data-enhance="follow"
    >
      <input type="hidden" name="username" value=${username} />
      <button type="submit" class=${following ? 'secondary' : undefined}>
        <${Icon} name=${following ? 'personMinus' : 'personPlus'} /><span
          >${following ? 'Unfollow' : 'Follow'}</span
        >
      </button>
    </form>
  `
}

// The profile's tagline: "3 followers · 2 following".
export function followTagline({ followerCount, followingCount }: FollowStats): string {
  return `${plural(followerCount, 'follower')} · ${followingCount} following`
}
