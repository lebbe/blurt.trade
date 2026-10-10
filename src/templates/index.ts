import { h } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import type { AuthenticatedUser } from '../middleware/auth.ts'
import type {
  Blurt,
  FeedItem,
  FollowStats,
  InviteCode,
  SignupState,
  UserProfile,
  WaitlistEntry,
} from '../routes/state.ts'

const html = htm.bind(h)

// Only http(s) links are ever rendered as hrefs; anything else (e.g. javascript:) is plain text.
export function isWebUrl(value: string): boolean {
  const url = URL.parse(value)
  return url?.protocol === 'http:' || url?.protocol === 'https:'
}

// The data each page is rendered from. A route fetches it once; it goes out as JSON as is,
// and as HTML or Markdown through the templates (see src/negotiate.ts).
export type Viewer = AuthenticatedUser | null

// Where a discovery section's blurts come from: 'similar' are close in meaning to what the
// viewer has blurted lately. Ticket 013a adds a geographic kind ('nearby').
export type DiscoveryKind = 'similar'

export const discoveryTitles: Record<DiscoveryKind, { title: string; description: string }> = {
  similar: { title: 'You might like', description: "Close to what you've blurted lately." },
}

// Blurts from outside the feed, shown after the first `after` of its `blurts`.
export type DiscoverySection = { kind: DiscoveryKind; after: number; blurts: Blurt[] }

// The discovery sections that go after the feed's first `count` blurts.
export function discoveryAfter(discovery: DiscoverySection[], count: number): DiscoverySection[] {
  return discovery.filter((section) => section.after === count)
}

// `feed` says which feed `blurts` is. `hasFollowingFeed` is whether the viewer follows
// enough accounts to get the following feed at `/` (and tabs between the two).
// `followedBlurts` are the latest from followed accounts, shown on top of the everyone
// feed until then. `discovery` is mixed in between `blurts`, on the first page only.
// `next` is the cursor for the page after this one, or null on the last.
export type FeedData = {
  viewer: Viewer
  feed: 'following' | 'everyone'
  hasFollowingFeed: boolean
  followedBlurts: FeedItem[]
  blurts: FeedItem[]
  discovery: DiscoverySection[]
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

// `invitedBy` is the username of whoever invited them (null if nobody did).
// `inviteCodes` are the profile's own codes, only for its owner (null for anyone else).
export type ProfilePageData = {
  viewer: Viewer
  profile: UserProfile
  invitedBy: string | null
  inviteCodes: InviteCode[] | null
  follows: FollowStats
  blurts: Blurt[]
  next: string | null
}

export type ProfileEditData = { viewer: Viewer; profile: UserProfile }

// Login has no data of its own.
export type FormPageData = { viewer: Viewer }

// `signup` says whether the sign-up form is open, needs an invite code, or is full.
// `inviteCode` fills in the form's invite code (from ?invite= or the submitted form).
export type SignupPageData = { viewer: Viewer; signup: SignupState; inviteCode: string | null }

// `waiting`: how many are on the waitlist. `username` is the one looked up with
// ?username=, and `entry` its waitlist entry (null if it has none).
export type WaitlistData = {
  viewer: Viewer
  signup: SignupState
  waiting: number
  username: string | null
  entry: WaitlistEntry | null
}

// `activeSessions`: how many browsers and devices the viewer is logged in on.
export type SettingsData = { viewer: AuthenticatedUser; activeSessions: number }

type ComposerProps = {
  text?: string
  validationError?: string
  parentId?: number
  label?: string
  button?: string
}

type FormProps = {
  username?: string
  validationError?: string
}

type CreateUserProps = SignupPageData & FormProps

type LoginProps = FormProps

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

function ValidationError({ message }: { message?: string }) {
  return message ? html`<p class="validation-error" role="alert">${message}</p>` : null
}

// The sign-up page in each state. Open sign-up takes an invite code too, optionally, so
// "invited by" still shows on the profile.
function CreateUserPage({ signup, inviteCode, username, validationError }: CreateUserProps) {
  const form = html`<${CreateUserForm}
    username=${username}
    inviteCode=${inviteCode ?? ''}
    inviteRequired=${signup === 'invite'}
    validationError=${validationError}
  />`
  if (signup === 'open') {
    return form
  }
  if (signup === 'invite') {
    return html`
      <section class="signup-closed" aria-label="Invite only">
        <h2>Invite only</h2>
        <p>
          blurt.trade is invite-only right now. You need an invite code from someone who's already
          here to sign up.
        </p>
        ${form}
        <p>Already have a profile? <a href="/login">Log in</a>.</p>
      </section>
    `
  }
  return html`
    <section class="signup-closed" aria-label="Waitlist">
      <h2>Sign-up is full</h2>
      <p>
        blurt.trade isn't taking new profiles right now. Leave the username you'd like and check
        back on the <a href="/waitlist">waitlist page</a>: it says when sign-up opens again.
      </p>
      <${WaitlistForm} username=${username} validationError=${validationError} />
      <p>Already have a profile? <a href="/login">Log in</a>.</p>
    </section>
  `
}

// Only a username: no email, so we never store anything personal or contact anyone.
function WaitlistForm({ username = '', validationError }: FormProps) {
  return html`
    <form method="post" action="/waitlist">
      <${ValidationError} message=${validationError} />
      <label>Username <input name="username" maxlength="40" required value=${username} /></label>
      <button type="submit">Join the waitlist</button>
    </form>
  `
}

function WaitlistPage({
  signup,
  waiting,
  username: lookedUp,
  entry,
  form,
}: WaitlistData & { form?: FormProps }) {
  const status = entry
    ? entry.status === 'joined'
      ? html`<p><a href="/${entry.username}/">${entry.username}</a> has signed up.</p>`
      : html`<p>${entry.username} is on the waitlist.</p>`
    : lookedUp && html`<p>${lookedUp} isn't on the waitlist.</p>`
  const opening =
    signup === 'open'
      ? html`<p>Sign-up is open again: <a href="/createUser">create your profile</a>.</p>`
      : signup === 'invite'
        ? html`<p>Sign-up has reopened, with an invite code: <a href="/createUser">sign up</a>.</p>`
        : html`<p>Sign-up is full. When it opens again, this page will say so.</p>`
  return html`
    <header>
      <h1>Waitlist</h1>
      <p><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      ${status} ${opening}
      <p>${plural(waiting, 'person', 'people')} waiting.</p>
      ${
        signup === 'waitlist' &&
        html`<${WaitlistForm} ...${form ?? {}} />
          <p>
            We don't take an email address, so we can't tell you when you're in. Bookmark this page
            after joining and check back.
          </p>`
      }
    </main>
  `
}

function CreateUserForm({
  username = '',
  inviteCode = '',
  inviteRequired = false,
  validationError,
}: FormProps & { inviteCode?: string; inviteRequired?: boolean }) {
  return html`
    <form method="post" action="/createUser">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label>Username <input name="username" maxlength="40" required value=${username} /></label>
      <label
        >Password <input name="password" type="password" minlength="8" maxlength="200" required
      /></label>
      <label
        >Invite code${inviteRequired ? '' : ' (optional)'}
        <input
          name="inviteCode"
          maxlength="40"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          required=${inviteRequired}
          value=${inviteCode}
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

function Discovery({ section }: { section: DiscoverySection }) {
  const { title, description } = discoveryTitles[section.kind]
  return html`
    <section aria-label=${title} class="discovery">
      <h2>${title}</h2>
      <p class="discovery-description">${description}</p>
      ${section.blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} />`)}
    </section>
  `
}

function FeedPage(data: FeedData & { composer?: ComposerProps }) {
  const { viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next, composer } = data
  const cards = (items: FeedItem[]) =>
    items.map((blurt) => html`<${BlurtCard} blurt=${blurt} replies=${blurt.replies} />`)
  const discoverySections = (count: number) =>
    discoveryAfter(discovery, count).map((section) => html`<${Discovery} section=${section} />`)

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
            ? blurts.map((blurt, index) => [cards([blurt]), discoverySections(index + 1)])
            : html`<p class="empty">
                ${
                  feed === 'following'
                    ? 'Nobody you follow has blurted yet.'
                    : 'Nothing has been blurted yet.'
                }
              </p>`
        }
        ${blurts.length === 0 && discoverySections(0)}
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

// Unused codes link to sign-up with the code filled in, ready to share.
function InviteCodes({ codes }: { codes: InviteCode[] }) {
  const now = new Date()
  const items = codes.map((invite) => {
    const status = invite.usedAt
      ? invite.usedBy
        ? html`used by <a href="/${invite.usedBy}/">${invite.usedBy}</a>`
        : 'used'
      : invite.expiresAt && invite.expiresAt <= now
        ? 'expired'
        : html`<a href="/createUser?invite=${invite.code}">sign-up link</a>${
              invite.expiresAt &&
              html`, expires
                <time datetime=${invite.expiresAt.toISOString()}>
                  ${invite.expiresAt.toISOString().slice(0, 10)}
                </time>`
            }`
    return html`<li><code>${invite.code}</code> · ${status}</li>`
  })
  return html`
    <section aria-label="Your invite codes">
      <h2>Your invite codes</h2>
      <p>Each code lets one person sign up, even while blurt.trade is invite-only.</p>
      ${
        items.length > 0
          ? html`<ul class="invite-codes">
              ${items}
            </ul>`
          : html`<p class="empty">You have no invite codes.</p>`
      }
    </section>
  `
}

function ProfilePage({
  viewer,
  profile,
  invitedBy,
  inviteCodes,
  follows,
  blurts,
  next,
}: ProfilePageData) {
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
      ${invitedBy && html`<p class="invited-by">Invited by <a href="/${invitedBy}/">${invitedBy}</a></p>`}
      ${
        viewer &&
        viewer.id !== profile.userId &&
        html`<${FollowForm} username=${profile.username} following=${follows.viewerFollows} />`
      }
      <${ProfileData} profile=${profile} canEdit=${viewer?.id === profile.userId} />
      ${inviteCodes && html`<${InviteCodes} codes=${inviteCodes} />`}
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
          .discovery {
            margin: 1.5rem 0;
            padding: 0 1rem 1rem;
            border: 1px dashed #aaa095;
          }
          .discovery h2 {
            margin: 1rem 0 0.25rem;
            font-size: 1.1rem;
          }
          .discovery-description {
            margin: 0;
            color: #6d6258;
            font-size: 0.9rem;
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

export function renderCreateUserPage(props: CreateUserProps): string {
  return (
    '<!doctype html>' + renderToString(h(IndexDocument, { children: h(CreateUserPage, props) }))
  )
}

export function renderWaitlistPage(data: WaitlistData, form?: FormProps): string {
  return (
    '<!doctype html>' +
    renderToString(h(IndexDocument, { children: h(WaitlistPage, { ...data, form }) }))
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
