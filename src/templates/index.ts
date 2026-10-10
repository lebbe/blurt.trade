import { h } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import type { AuthenticatedUser } from '../middleware/auth.ts'
import type { Blurt, FeedItem, FollowStats, UserProfile } from '../routes/state.ts'

const html = htm.bind(h)

// Only http(s) links are ever rendered as hrefs; anything else (e.g. javascript:) is plain text.
export function isWebUrl(value: string): boolean {
  const url = URL.parse(value)
  return url?.protocol === 'http:' || url?.protocol === 'https:'
}

// The data each page is rendered from. A route fetches it once; it goes out as JSON as is,
// and as HTML or Markdown through the templates (see src/negotiate.ts).
export type Viewer = AuthenticatedUser | null

// `feed` says which feed `blurts` is. `hasFollowingFeed` is whether the viewer follows
// enough accounts to get the following feed at `/` (and tabs between the two).
// `followedBlurts` are the latest from followed accounts, shown on top of the everyone
// feed until then. `next` is the cursor for the page after this one, or null on the last.
export type FeedData = {
  viewer: Viewer
  feed: 'following' | 'everyone'
  hasFollowingFeed: boolean
  followedBlurts: FeedItem[]
  blurts: FeedItem[]
  next: string | null
}

// Where the feed in `data` lives, for its "Older blurts" link.
export function feedPath({ feed, hasFollowingFeed }: FeedData): string {
  return feed === 'everyone' && hasFollowingFeed ? '/everyone' : '/'
}

export type BlurtPageData = {
  viewer: Viewer
  blurt: Blurt
  parent: Blurt | null
  replies: Blurt[]
  next: string | null // for replies
  related: Blurt[]
}

export type ProfilePageData = {
  viewer: Viewer
  profile: UserProfile
  follows: FollowStats
  blurts: Blurt[]
  next: string | null
}

export type ProfileEditData = { viewer: Viewer; profile: UserProfile }

// Login and sign-up have no data of their own.
export type FormPageData = { viewer: Viewer }

// `activeSessions`: how many browsers and devices the viewer is logged in on.
export type SettingsData = { viewer: AuthenticatedUser; activeSessions: number }

type ComposerProps = {
  text?: string
  validationError?: string
  parentId?: number
  label?: string
  button?: string
}

type CreateUserProps = {
  username?: string
  validationError?: string
}

type LoginProps = CreateUserProps

type ProfileEditProps = ProfileEditData & { validationError?: string }

function Composer({
  text = '',
  validationError,
  parentId,
  label = 'Blurt',
  button = 'Blurt it',
}: ComposerProps) {
  return html`
    <form method="post" action="/api/blurts">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      ${parentId !== undefined && html`<input type="hidden" name="parentId" value=${parentId} />`}
      <label>${label} <textarea name="text" maxlength="280" required>${text}</textarea></label>
      <button type="submit">${button}</button>
    </form>
  `
}

function CreateUserForm({ username = '', validationError }: CreateUserProps) {
  return html`
    <form method="post" action="/createUser">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label>Username <input name="username" maxlength="40" required value=${username} /></label>
      <label
        >Password <input name="password" type="password" minlength="8" maxlength="200" required
      /></label>
      <button type="submit">Create user</button>
    </form>
  `
}

function AnonymousActions() {
  return html`
    <p>
      <a href="/login">Log in</a>
      or
      <a href="/createUser">create a profile</a>
      to blurt.
    </p>
  `
}

function LoginForm({ username = '', validationError }: LoginProps) {
  return html`
    <form method="post" action="/login">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label>Username <input name="username" maxlength="40" required value=${username} /></label>
      <label>Password <input name="password" type="password" maxlength="200" required /></label>
      <button type="submit">Log in</button>
    </form>
  `
}

function LogoutForm() {
  return html`
    <form method="post" action="/api/logout">
      <a href="/settings">Settings</a>
      <button type="submit">Log out</button>
    </form>
  `
}

function SettingsPage({ viewer, activeSessions }: SettingsData) {
  return html`
    <header>
      <h1>Settings: ${viewer.username}</h1>
      <p><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      <section aria-label="Sessions">
        <h2>Sessions</h2>
        <p>
          You're logged in on ${plural(activeSessions, 'browser or device', 'browsers or devices')}.
        </p>
        <p>
          Lost a phone, or logged in somewhere you shouldn't have? Log out everywhere, this browser
          included. Other devices are logged out within 5 minutes.
        </p>
        <form method="post" action="/api/logout-everywhere">
          <button type="submit">Log out everywhere</button>
        </form>
      </section>
    </main>
  `
}

export function blurtUrl(blurt: Blurt): string {
  return `/${blurt.username}/${blurt.id}`
}

// Where the next page of each list lives. Plain links, so paging works without JS.
export function olderBlurtsUrl(path: string, next: string): string {
  return `${path}?before=${next}`
}

export function moreRepliesUrl(blurt: Blurt, next: string): string {
  return `${blurtUrl(blurt)}?after=${next}`
}

function NextPageLink({ href, label }: { href: string; label: string }) {
  return html`<p class="next-page"><a href=${href} rel="next">${label}</a></p>`
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

// `replies` are shown inline (the feed); the link below covers the rest of the thread.
function BlurtCard({
  blurt,
  replies = [],
  showActions = true,
}: {
  blurt: Blurt
  replies?: Blurt[]
  showActions?: boolean
}) {
  const hiddenReplies = blurt.replyCount - replies.length
  const threadLink =
    hiddenReplies <= 0
      ? 'Reply'
      : replies.length > 0
        ? plural(hiddenReplies, 'more reply', 'more replies')
        : plural(hiddenReplies, 'reply', 'replies')

  return html`
    <article class="blurt">
      <div class="blurt-meta">
        <strong><a href="/${blurt.username}/">${blurt.username}</a></strong>
        <a href=${blurtUrl(blurt)}
          ><time datetime=${blurt.createdAt.toISOString()}
            >${blurt.createdAt.toLocaleString()}</time
          ></a
        >
      </div>
      <p>${blurt.text}</p>
      ${
        replies.length > 0 &&
        html`<div class="replies">
          ${replies.map((reply) => html`<${BlurtCard} blurt=${reply} />`)}
        </div>`
      }
      ${
        showActions &&
        html`<p class="blurt-actions"><a href=${blurtUrl(blurt)}>${threadLink}</a></p>`
      }
    </article>
  `
}

type BlurtPageProps = BlurtPageData & { composer?: ComposerProps }

function BlurtPage({ viewer, blurt, parent, replies, next, related, composer }: BlurtPageProps) {
  return html`
    <header>
      <h1>${blurt.username}</h1>
      <p class="tagline"><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      ${
        parent &&
        html`<section aria-label="In reply to">
          <h2>In reply to</h2>
          <${BlurtCard} blurt=${parent} />
        </section>`
      }
      <${BlurtCard} blurt=${blurt} showActions=${false} />
      <section aria-label="Replies">
        <h2>Replies</h2>
        ${
          viewer
            ? html`<${Composer}
                ...${composer ?? {}}
                parentId=${blurt.id}
                label="Reply"
                button="Reply"
              />`
            : html`<${AnonymousActions} />`
        }
        ${
          replies.length > 0
            ? replies.map((reply) => html`<${BlurtCard} blurt=${reply} />`)
            : html`<p class="empty">No replies yet.</p>`
        }
        ${next && html`<${NextPageLink} href=${moreRepliesUrl(blurt, next)} label="More replies" />`}
      </section>
      <section aria-label="Related blurts">
        <h2>Related blurts</h2>
        ${
          related.length > 0
            ? related.map((other) => html`<${BlurtCard} blurt=${other} />`)
            : html`<p class="empty">Nothing related yet.</p>`
        }
      </section>
    </main>
  `
}

function renderSocial(value: string): unknown {
  if (!value) {
    return html`<span class="empty">Not set</span>`
  }

  if (isWebUrl(value)) {
    return html`<a href=${value}>${value}</a>`
  }

  return html`<span>${value}</span>`
}

function ProfileData({ profile, canEdit }: { profile: UserProfile; canEdit: boolean }) {
  return html`
    <section aria-label="Profile">
      <div class="section-title">
        <h2>Profile</h2>
        ${
          canEdit &&
          html`<a class="button-link" href="/${profile.username}/edit" aria-label="Edit profile"
            >Edit profile</a
          >`
        }
      </div>
      <dl class="profile-data">
        <dt>Homepage</dt>
        <dd>${renderSocial(profile.homepage)}</dd>
        <dt>X</dt>
        <dd>${renderSocial(profile.x)}</dd>
        <dt>Instagram</dt>
        <dd>${renderSocial(profile.instagram)}</dd>
        <dt>TikTok</dt>
        <dd>${renderSocial(profile.tiktok)}</dd>
        <dt>YouTube</dt>
        <dd>${renderSocial(profile.youtube)}</dd>
        <dt>GitHub</dt>
        <dd>${renderSocial(profile.github)}</dd>
        <dt>LinkedIn</dt>
        <dd>${renderSocial(profile.linkedin)}</dd>
        <dt>Bio</dt>
        <dd>${profile.bio || html`<span class="empty">Not set</span>`}</dd>
      </dl>
    </section>
  `
}

function ProfileEditForm({ profile, validationError }: ProfileEditProps) {
  return html`
    <header>
      <h1>Edit profile: ${profile.username}</h1>
      <p><a href="/${profile.username}/">Back to profile</a></p>
    </header>
    <main>
      <form method="post" action="/${profile.username}/edit">
        ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
        <label
          >Homepage
          <input
            name="homepage"
            maxlength="200"
            value=${profile.homepage}
            placeholder="https://example.com"
          />
        </label>
        <label
          >X
          <input name="x" maxlength="200" value=${profile.x} placeholder="@handle or full URL" />
        </label>
        <label
          >Instagram
          <input
            name="instagram"
            maxlength="200"
            value=${profile.instagram}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >TikTok
          <input
            name="tiktok"
            maxlength="200"
            value=${profile.tiktok}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >YouTube
          <input
            name="youtube"
            maxlength="200"
            value=${profile.youtube}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >GitHub
          <input
            name="github"
            maxlength="200"
            value=${profile.github}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >LinkedIn
          <input
            name="linkedin"
            maxlength="200"
            value=${profile.linkedin}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >Bio
          <textarea name="bio" maxlength="4000" placeholder="Say the thing.">
${profile.bio}</textarea>
        </label>
        <button type="submit">Save profile</button>
      </form>
    </main>
  `
}

function FeedTabs({ feed }: { feed: FeedData['feed'] }) {
  return html`
    <nav class="tabs" aria-label="Feeds">
      <a href="/" aria-current=${feed === 'following' ? 'page' : undefined}>Following</a>
      <a href="/everyone" aria-current=${feed === 'everyone' ? 'page' : undefined}>Everyone</a>
    </nav>
  `
}

function FeedPage(data: FeedData & { composer?: ComposerProps }) {
  const { viewer, feed, hasFollowingFeed, followedBlurts, blurts, next, composer } = data
  const cards = (items: FeedItem[]) =>
    items.map((blurt) => html`<${BlurtCard} blurt=${blurt} replies=${blurt.replies} />`)

  return html`
    <header>
      <h1>blurt.trade</h1>
      <p class="tagline">Say the thing. Regret it later.</p>
    </header>
    <main>
      ${viewer ? html`<${Composer} ...${composer ?? {}} />` : html`<${AnonymousActions} />`}
      ${viewer && html`<${LogoutForm} />`} ${hasFollowingFeed && html`<${FeedTabs} feed=${feed} />`}
      ${
        followedBlurts.length > 0 &&
        html`<section aria-label="From people you follow" class="followed">
          <h2>From people you follow</h2>
          ${cards(followedBlurts)}
        </section>`
      }
      <section aria-label="Blurts">
        ${
          blurts.length > 0
            ? cards(blurts)
            : html`<p class="empty">
                ${
                  feed === 'following'
                    ? 'Nobody you follow has blurted yet.'
                    : 'Nothing has been blurted yet.'
                }
              </p>`
        }
        ${
          next &&
          html`<${NextPageLink}
            href=${olderBlurtsUrl(feedPath(data), next)}
            label="Older blurts"
          />`
        }
      </section>
    </main>
  `
}

function FollowForm({ username, following }: { username: string; following: boolean }) {
  return html`
    <form method="post" action=${following ? '/api/unfollow' : '/api/follow'} class="follow-form">
      <input type="hidden" name="username" value=${username} />
      <button type="submit">${following ? 'Unfollow' : 'Follow'}</button>
    </form>
  `
}

function ProfilePage({ viewer, profile, follows, blurts, next }: ProfilePageData) {
  const feed = blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} />`)

  return html`
    <header>
      <h1>${profile.username}</h1>
      <p class="tagline"><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      <p class="follow-counts">
        ${plural(follows.followerCount, 'follower')} · ${follows.followingCount} following
      </p>
      ${
        viewer &&
        viewer.id !== profile.userId &&
        html`<${FollowForm} username=${profile.username} following=${follows.viewerFollows} />`
      }
      <${ProfileData} profile=${profile} canEdit=${viewer?.id === profile.userId} />
      <section aria-label="${profile.username} blurts">
        <h2>Blurts</h2>
        ${feed.length > 0 ? feed : html`<p class="empty">Nothing has been blurted yet.</p>`}
        ${
          next &&
          html`<${NextPageLink}
            href=${olderBlurtsUrl(`/${profile.username}/`, next)}
            label="Older blurts"
          />`
        }
      </section>
    </main>
  `
}

function IndexDocument({ children }: { children: unknown }) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>blurt.trade</title>
        <style>
          :root {
            color-scheme: light;
            font-family: Georgia, serif;
            background: #f4f0e8;
            color: #201d1a;
          }
          body {
            max-width: 42rem;
            margin: 0 auto;
            padding: 2rem 1rem;
          }
          h1 {
            margin: 0 0 0.25rem;
            font-size: 2.5rem;
          }
          .tagline {
            margin: 0 0 2rem;
            color: #6d6258;
          }
          form,
          .blurt {
            border: 1px solid #cfc5b8;
            background: #fffdf8;
            padding: 1rem;
          }
          form {
            display: grid;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
          }
          .validation-error {
            margin: 0;
            color: #a32020;
            font-weight: bold;
          }
          label {
            display: grid;
            gap: 0.3rem;
            font-size: 0.9rem;
          }
          input,
          textarea,
          button {
            font: inherit;
            padding: 0.65rem;
            border: 1px solid #aaa095;
          }
          textarea {
            min-height: 5rem;
            resize: vertical;
          }
          button {
            background: #201d1a;
            color: #fffdf8;
            cursor: pointer;
          }
          .button-link {
            display: inline-block;
            border: 1px solid #aaa095;
            background: #201d1a;
            color: #fffdf8;
            text-decoration: none;
            padding: 0.45rem 0.8rem;
          }
          .section-title {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.6rem;
          }
          .section-title h2 {
            margin: 0;
          }
          .profile-data {
            border: 1px solid #cfc5b8;
            background: #fffdf8;
            margin: 0 0 1rem;
            padding: 1rem;
          }
          .profile-data dt {
            font-weight: bold;
            margin-top: 0.7rem;
          }
          .profile-data dt:first-child {
            margin-top: 0;
          }
          .profile-data dd {
            margin: 0.2rem 0 0;
          }
          .blurt {
            margin-top: 0.75rem;
          }
          .blurt-meta {
            display: flex;
            justify-content: space-between;
            gap: 1rem;
          }
          time {
            color: #6d6258;
            font-size: 0.85rem;
          }
          .empty {
            color: #6d6258;
          }
          .replies {
            margin-left: 1rem;
            padding-left: 0.75rem;
            border-left: 3px solid #cfc5b8;
          }
          .replies .blurt {
            padding: 0.6rem;
          }
          .blurt-actions {
            margin: 0.5rem 0 0;
            font-size: 0.85rem;
          }
          section h2 {
            margin-top: 2rem;
          }
          .tabs {
            display: flex;
            gap: 1rem;
            margin: 1.5rem 0 0;
          }
          .tabs a[aria-current='page'] {
            font-weight: bold;
            color: inherit;
            text-decoration: none;
          }
          .follow-counts {
            margin: 0 0 0.75rem;
            color: #6d6258;
          }
          .follow-form {
            display: inline-block;
            border: 0;
            background: none;
            padding: 0;
          }
          .next-page {
            margin: 1.5rem 0 0;
            text-align: center;
          }
        </style>
      </head>
      <body>
        ${children}
      </body>
    </html>`
}

export function renderFeedPage(data: FeedData, composer?: ComposerProps): string {
  return (
    '<!doctype html>' +
    renderToString(h(IndexDocument, { children: h(FeedPage, { ...data, composer }) }))
  )
}

export function renderLoginPage(props: LoginProps = {}): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(LoginForm, props) }))
}

export function renderCreateUserPage(props: CreateUserProps = {}): string {
  return (
    '<!doctype html>' + renderToString(h(IndexDocument, { children: h(CreateUserForm, props) }))
  )
}

export function renderBlurtPage(data: BlurtPageData, composer?: ComposerProps): string {
  return (
    '<!doctype html>' +
    renderToString(h(IndexDocument, { children: h(BlurtPage, { ...data, composer }) }))
  )
}

export function renderProfilePage(data: ProfilePageData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(ProfilePage, data) }))
}

export function renderSettingsPage(data: SettingsData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(SettingsPage, data) }))
}

export function renderProfileEditPage(props: ProfileEditProps): string {
  return (
    '<!doctype html>' + renderToString(h(IndexDocument, { children: h(ProfileEditForm, props) }))
  )
}
