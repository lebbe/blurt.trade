import { h, type ComponentChildren } from 'preact'
import htm from 'htm'
import { gridDegrees, mapHeight, mapUrl, mapWidth, pointToPixel, type GeoPoint } from '../geo.ts'
import type { AuthenticatedUser } from '../middleware/auth.ts'
import type { Contact } from '../config.ts'
import {
  avatarLabels,
  eyeTypes,
  hairTypes,
  headWidths,
  toothTypes,
  type Avatar,
} from '../avatar.ts'
import { AvatarSvg } from './avatar.ts'
import { renderBlurtText } from './blurt-text.ts'
import { Icon, type IconName } from './icons.ts'
import { pageContext } from '../page-context.ts'
import { themes } from '../themes.ts'
import { formatTimestamp, localeLabel, locales, timeZones } from '../timezones.ts'
import { Page, preview, renderDocument, siteDescription, type PageMeta } from './layout.ts'
import { blurtOgInput, ogHash, ogImagePath, ogProfileImagePath, profileCardText } from '../og.ts'
import { cardColors, type CardColorId } from '../card-colors.ts'
import {
  bioMaxLength,
  blurtMaxLength,
  isWebUrl,
  linkMaxLength,
  normalizedWebUrl,
  passwordMaxLength,
  passwordMinLength,
  reportReasonMaxLength,
  searchQueryMaxLength,
  usernameMaxLength,
} from '../limits.ts'
import type {
  Blurt,
  FeedItem,
  FollowStats,
  InviteCode,
  QuotedBlurt,
  ReportedBlurt,
  SignupState,
  UserMatch,
  UserProfile,
  WaitlistEntry,
} from '../routes/state.ts'

const html = htm.bind(h)

// The data each page is rendered from. A route fetches it once; it goes out as JSON as is,
// and as HTML or Markdown through the templates (see src/negotiate.ts).
export type Viewer = AuthenticatedUser | null

// Where a discovery section's blurts come from: 'similar' are close in meaning to what the
// viewer has blurted lately, 'nearby' from people whose location is near theirs.
export type DiscoveryKind = 'similar' | 'nearby'

export const discoveryTitles: Record<DiscoveryKind, { title: string; description: string }> = {
  similar: { title: 'You might like', description: "Close to what you've blurted lately." },
  nearby: { title: 'Near you', description: 'From people near where you are.' },
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

// `reported`: whether the viewer has reported `blurt` (false for anonymous viewers).
export type BlurtPageData = {
  viewer: Viewer
  blurt: Blurt
  parent: Blurt | null
  reported: boolean
  replies: Blurt[]
  next: string | null // for replies
  related: Blurt[]
  // The author's card colour, for the share image (null: the default).
  cardColor?: CardColorId | null
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

// `location` is the owner's coarse location (null if not set). The edit page is the only
// profile page that has it.
export type ProfileEditData = { viewer: Viewer; profile: UserProfile; location: GeoPoint | null }

// "Blurts near you". `location` is the viewer's own (null if not set: then no blurts).
// `radius` is in km, one of `radii`. `next` is the cursor for older blurts.
export type NearData = {
  viewer: AuthenticatedUser
  location: GeoPoint | null
  radius: number
  radii: number[]
  blurts: FeedItem[]
  next: string | null
}

// A stored location as people read it, e.g. "59.5° N, 10.5° E".
export function formatLocation({ lat, lon }: GeoPoint): string {
  return `${Math.abs(lat)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon)}° ${lon < 0 ? 'W' : 'E'}`
}

export const gridDescription = `a ${gridDegrees}° by ${gridDegrees}° square, about ${Math.round(gridDegrees * 111)} km across`

export function nearPageUrl(radius: number, next?: string): string {
  return `/near?radius=${radius}${next ? `&before=${next}` : ''}`
}

// /search: `query` as searched for ('' before a search), matching users (first page only)
// and blurts, newest first. `next` is the cursor for older matching blurts.
export type SearchData = {
  viewer: Viewer
  query: string
  users: UserMatch[]
  blurts: Blurt[]
  next: string | null
}

export function searchUrl(query: string, next?: string): string {
  return `/search?q=${encodeURIComponent(query)}${next ? `&before=${next}` : ''}`
}

// Login has no data of its own.
export type FormPageData = { viewer: Viewer }

// /about, /terms and /privacy: fixed text, plus how to reach whoever runs the site.
export type InfoPageData = { viewer: Viewer; contact: Contact }

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

// /admin: forms for the admin APIs. `minted` is set after minting invite codes.
export type AdminToolsData = {
  viewer: AuthenticatedUser
  minted?: { username: string; codes: string[] }
}

// /admin/reports: blurts with open reports, the one waiting longest first.
export type AdminReportsData = { viewer: AuthenticatedUser; reports: ReportedBlurt[] }

// `activeSessions`: how many browsers and devices the viewer is logged in on.
export type SettingsData = { viewer: AuthenticatedUser; activeSessions: number }

// /settings/delete, the account deletion confirmation.
export type DeleteAccountData = { viewer: AuthenticatedUser }

// `parentId` makes it a reply form, `reblurtOfId` a quote form. `label` names the text
// box for screen readers; `id` is the panel's, for links to it (#quote).
type ComposerProps = {
  text?: string
  validationError?: string
  parentId?: number
  reblurtOfId?: number
  heading?: string
  label?: string
  placeholder?: string
  button?: string
  id?: string
}

type FormProps = {
  username?: string
  validationError?: string
}

type CreateUserProps = SignupPageData & FormProps

type LoginProps = FormProps

type ProfileEditProps = ProfileEditData & {
  validationError?: string
  locationError?: string
  avatarError?: string
}

// A blurt form in its own panel: the first thing on the pages people read blurts on.
function Composer({
  text = '',
  validationError,
  parentId,
  reblurtOfId,
  heading = 'Blurt now',
  label = 'Blurt',
  button = 'Blurt it',
  placeholder = siteDescription,
  id,
}: ComposerProps) {
  return html`
    <section class="panel composer" id=${id}>
      <h2>${heading}</h2>
      <form method="post" action="/api/blurts" enctype="multipart/form-data">
        ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
        ${parentId !== undefined && html`<input type="hidden" name="parentId" value=${parentId} />`}
        ${
          reblurtOfId !== undefined &&
          html`<input type="hidden" name="reblurtOfId" value=${reblurtOfId} />`
        }
        <textarea
          name="text"
          maxlength=${blurtMaxLength}
          required
          aria-label=${label}
          placeholder=${placeholder}
        >
${text}</textarea>
        <label class="picture-field tiny">
          Picture (optional)
          <input type="file" name="picture" accept="image/jpeg,image/png,image/webp" />
        </label>
        <p class="tiny">The picture is redrawn as a rough drawing. The original is not stored.</p>
        <div class="row">
          <span class="tiny">${blurtMaxLength} characters max · public</span>
          <button type="submit" class="blurt-button">
            <${Icon} name=${parentId === undefined ? 'megaphone' : 'reply'} /><span>${button}</span>
          </button>
        </div>
      </form>
    </section>
  `
}

function ValidationError({ message }: { message?: string }) {
  return message ? html`<p class="validation-error" role="alert">${message}</p>` : null
}

// A link that looks like a button, with an icon. `kind` '' is the main (filled) style.
function ButtonLink({
  href,
  icon,
  label,
  kind = 'secondary',
}: {
  href: string
  icon: IconName
  label: string
  kind?: '' | 'secondary' | 'danger'
}) {
  return html`<a class=${kind ? `button ${kind}` : 'button'} href=${href}
    ><${Icon} name=${icon} /><span>${label}</span></a
  >`
}

// Today a plain link to the share card image, which works without JavaScript. With
// JavaScript it can become the share button of the browser or a social network.
function ShareLink({ href }: { href: string }) {
  return html`<${ButtonLink} href=${href} icon="share" label="Share" />`
}

function SubmitButton({
  icon,
  label,
  kind = '',
}: {
  icon: IconName
  label: string
  kind?: '' | 'secondary' | 'danger'
}) {
  return html`<button type="submit" class=${kind || undefined}>
    <${Icon} name=${icon} /><span>${label}</span>
  </button>`
}

// For the asides: a panel with a heading and a list of links.
function LinkPanel({ title, links }: { title: string; links: [href: string, label: string][] }) {
  return html`
    <section class="panel">
      <h3>${title}</h3>
      <ul class="list">
        ${links.map(([href, label]) => html`<li><a href=${href}>${label}</a></li>`)}
      </ul>
    </section>
  `
}

// The links below every logged-in page's aside, and the whole aside for anonymous ones.
function SupportLinks() {
  return html`<${LinkPanel}
    title="About this site"
    links=${[
      ['/about', 'About and contact'],
      ['/terms', 'Terms'],
      ['/privacy', 'Privacy'],
    ]}
  />`
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
  const aside = html`
    <section class="panel">
      <h3>Already here?</h3>
      <p>Welcome back.</p>
      <${ButtonLink} href="/login" icon="login" label="Log in" />
    </section>
    <${SupportLinks} />
  `
  if (signup === 'open') {
    return html`
      <${Page}
        title="Create a profile"
        tagline="Pick a name. Blurt within a minute."
        aside=${aside}
      >
        <section class="panel">${form}</section>
      <//>
    `
  }
  if (signup === 'invite') {
    return html`
      <${Page} title="Create a profile" tagline="Invite only, for now." aside=${aside}>
        <section class="panel signup-closed" aria-label="Invite only">
          <h2>Invite only</h2>
          <p>
            blurt.trade is invite-only right now. You need an invite code from someone who's already
            here to sign up.
          </p>
          ${form}
          <p>Already have a profile? <a href="/login">Log in</a>.</p>
        </section>
      <//>
    `
  }
  return html`
    <${Page} title="Create a profile" tagline="We're full right now." aside=${aside}>
      <section class="panel signup-closed" aria-label="Waitlist">
        <h2>Sign-up is full</h2>
        <p>
          blurt.trade isn't taking new profiles right now. Leave the username you'd like and check
          back on the <a href="/waitlist">waitlist page</a>: it says when sign-up opens again.
        </p>
        <${WaitlistForm} username=${username} validationError=${validationError} />
        <p>Already have a profile? <a href="/login">Log in</a>.</p>
      </section>
    <//>
  `
}

// Only a username: no email, so we never store anything personal or contact anyone.
function WaitlistForm({ username = '', validationError }: FormProps) {
  return html`
    <form method="post" action="/waitlist">
      <${ValidationError} message=${validationError} />
      <label
        >Username <input name="username" maxlength=${usernameMaxLength} required value=${username}
      /></label>
      <div class="actions"><${SubmitButton} icon="hourglass" label="Join the waitlist" /></div>
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
    <${Page}
      title="Waitlist"
      tagline=${plural(waiting, 'person', 'people') + ' waiting.'}
      aside=${html`<${SupportLinks} />`}
    >
      <section class="panel">
        ${status} ${opening}
        <p class="tiny">${plural(waiting, 'person', 'people')} waiting.</p>
      </section>
      ${
        signup === 'waitlist' &&
        html`<section class="panel">
          <h2>Join the waitlist</h2>
          <${WaitlistForm} ...${form ?? {}} />
          <p class="hint">
            We don't take an email address, so we can't tell you when you're in. Bookmark this page
            after joining and check back.
          </p>
        </section>`
      }
    <//>
  `
}

// Said at sign-up, in the terms and on the privacy page: no email means no reset.
export const noPasswordReset =
  "Keep your password safe, e.g. in a password manager. We don't take an email address, " +
  "so there's no password reset: a lost password can't be recovered, and neither can the " +
  'account.'

// On the login page, followed by a link to /privacy.
export const forgotPassword = "Forgot your password? There's no password reset, see"

function CreateUserForm({
  username = '',
  inviteCode = '',
  inviteRequired = false,
  validationError,
}: FormProps & { inviteCode?: string; inviteRequired?: boolean }) {
  return html`
    <form method="post" action="/createUser">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label
        >Username <input name="username" maxlength=${usernameMaxLength} required value=${username}
      /></label>
      <label
        >Password
        <input
          name="password"
          type="password"
          autocomplete="new-password"
          minlength=${passwordMinLength}
          maxlength=${passwordMaxLength}
          required
      /></label>
      <label
        >Repeat password
        <input
          name="passwordConfirm"
          type="password"
          autocomplete="new-password"
          maxlength=${passwordMaxLength}
      /></label>
      <label class="check"
        ><input type="checkbox" name="skipConfirm" value="1" /> Skip repeating the password</label
      >
      <p class="hint password-hint">${noPasswordReset}</p>
      <label
        >Invite code${inviteRequired ? '' : ' (optional)'}
        <input
          name="inviteCode"
          maxlength=${usernameMaxLength}
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          required=${inviteRequired}
          value=${inviteCode}
      /></label>
      <div class="actions"><${SubmitButton} icon="personPlus" label="Create user" /></div>
    </form>
  `
}

// Where a composer would be, for anonymous visitors.
function AnonymousActions({ heading = 'Blurt now' }: { heading?: string }) {
  return html`
    <section class="panel composer">
      <h2>${heading}</h2>
      <p>Make a profile to blurt. It takes a username and a password, nothing else.</p>
      <div class="actions">
        <${ButtonLink} href="/createUser" icon="personPlus" label="Create a profile" kind="" />
        <${ButtonLink} href="/login" icon="login" label="Log in" />
      </div>
    </section>
  `
}

function LoginPage({ username = '', validationError }: LoginProps) {
  return html`
    <${Page}
      title="Log in"
      tagline="Back for more blurting."
      aside=${html`
        <section class="panel">
          <h3>New here?</h3>
          <p>A username and a password is all it takes. No email, no phone number.</p>
          <${ButtonLink} href="/createUser" icon="personPlus" label="Create a profile" />
        </section>
        <${SupportLinks} />
      `}
    >
      <section class="panel">
        <form method="post" action="/login">
          ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
          <label
            >Username
            <input name="username" maxlength=${usernameMaxLength} required value=${username}
          /></label>
          <label
            >Password
            <input name="password" type="password" maxlength=${passwordMaxLength} required
          /></label>
          <div class="actions"><${SubmitButton} icon="login" label="Log in" /></div>
          <p class="hint">${forgotPassword} <a href="/privacy">Privacy</a>.</p>
        </form>
      </section>
    <//>
  `
}

function SettingsPage({ viewer, activeSessions }: SettingsData) {
  const edit = `/${viewer.username}/edit`
  return html`
    <${Page}
      title="Settings"
      tagline=${`Account and safety controls for ${viewer.username}, all in plain sight.`}
      aside=${html`<${SupportLinks} />`}
    >
      <section class="panel" aria-label="Sessions">
        <h2>Sessions</h2>
        <p>
          You're logged in on ${plural(activeSessions, 'browser or device', 'browsers or devices')}.
        </p>
        <p class="tiny">
          Lost a phone, or logged in somewhere you shouldn't have? Log out everywhere, this browser
          included. Other devices are logged out within 5 minutes.
        </p>
        <div class="actions">
          <form method="post" action="/api/logout" class="inline">
            <${SubmitButton} icon="logout" label="Log out" kind="secondary" />
          </form>
          <form method="post" action="/api/logout-everywhere" class="inline">
            <${SubmitButton} icon="shield" label="Log out everywhere" />
          </form>
        </div>
      </section>
      <section class="panel" aria-label="Profile and appearance">
        <h2>Profile and appearance</h2>
        <div class="actions">
          <${ButtonLink} href=${edit} icon="edit" label="Edit profile" />
          <${ButtonLink} href=${`${edit}#avatar`} icon="person" label="Avatar" />
          <${ButtonLink} href=${`${edit}#location`} icon="pin" label="Location" />
          <${ButtonLink} href=${`${edit}#theme`} icon="palette" label="Theme" />
        </div>
      </section>
      <section class="panel" aria-label="Delete account">
        <h2 class="warn">Delete account</h2>
        <p>Deletes your profile and your blurts for good. You'll be asked for your password.</p>
        <${ButtonLink}
          href="/settings/delete"
          icon="warning"
          label="Delete my account"
          kind="danger"
        />
      </section>
    <//>
  `
}

// What deleting an account does: on the confirmation page, in both views.
export const accountDeletionEffects = [
  'Your profile, avatar, location, follows (both ways), likes, reblurts, sessions, invite codes and reports are deleted.',
  'Your blurts, replies and quotes are deleted: their text is removed, and nothing shows they were yours. One that someone replied to stays as an empty placeholder, with no text and no author, so their replies still read.',
  'Your username is retired: nobody can sign up with it again, so nobody can pass for you.',
  "You're logged out everywhere. It can't be undone; nightly backups still hold the account for up to 30 days.",
]

function DeleteAccountPage({ viewer, validationError }: DeleteAccountData & FormProps) {
  return html`
    <${Page}
      title=${`Delete account: ${viewer.username}`}
      tagline="For good. There is no undo."
      actions=${html`<${ButtonLink} href="/settings" icon="back" label="Back to settings" />`}
    >
      <section class="panel">
        <h2 class="warn">What happens</h2>
        <ul>
          ${accountDeletionEffects.map((effect) => html`<li>${effect}</li>`)}
        </ul>
        <form method="post" action="/settings/delete">
          ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
          <label
            >Your password, to confirm
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              maxlength=${passwordMaxLength}
              required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="warning" label="Delete my account for good" kind="danger" />
          </div>
        </form>
      </section>
    <//>
  `
}

// A deleted placeholder has no author, so it lives at /deleted/:id ('deleted' is a
// reserved username). Its page also answers under the old author's name.
export function blurtUrl(blurt: Pick<Blurt, 'id' | 'username'>): string {
  return `/${blurt.username ?? 'deleted'}/${blurt.id}`
}

// The blurt a reply replies to. Its author is null when that blurt was deleted.
export function parentUrl(blurt: Blurt): string | null {
  return blurt.parentId === null
    ? null
    : blurtUrl({ id: blurt.parentId, username: blurt.parentUsername })
}

// Where the quote form for a blurt is: on its page.
export function quoteUrl(blurt: Blurt): string {
  return `${blurtUrl(blurt)}#quote`
}

// Logged-in viewers can plain-reblurt anyone's blurt but their own (quoting is fine), and
// undo a reblurt they made. Placeholders take neither.
export function reblurtAction(viewer: Viewer, blurt: Blurt): 'reblurt' | 'unreblurt' | null {
  if (!viewer || blurt.deleted) {
    return null
  }
  if (blurt.viewerReblurted) {
    return 'unreblurt'
  }
  return viewer.username === blurt.username ? null : 'reblurt'
}

export function deleteBlurtPath(blurt: Blurt): string {
  return `/api/blurts/${blurt.id}/delete`
}

// Who may do what to a blurt, in every view: its author deletes it, anyone else logged in
// can report it. Placeholders take neither.
export function blurtActions(viewer: Viewer, blurt: Blurt): 'delete' | 'report' | null {
  if (!viewer || blurt.deleted) {
    return null
  }
  return viewer.username === blurt.username ? 'delete' : 'report'
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

// The id of a blurt's <article>, so a like form's redirect lands back at the blurt.
export function blurtAnchor(blurt: Blurt): string {
  return `blurt-${blurt.id}`
}

// The count for everyone; logged-in viewers get it as a Like / Unlike button.
function Likes({ blurt, viewer }: { blurt: Blurt; viewer: Viewer }) {
  const count = plural(blurt.likeCount, 'like')
  if (!viewer) {
    return html`<span class="action-count"
      ><${Icon} name="heart" /><span class="like-count">${count}</span></span
    >`
  }
  return html`
    <form method="post" action=${blurt.viewerLikes ? '/api/unlike' : '/api/like'} class="like-form">
      <input type="hidden" name="blurtId" value=${blurt.id} />
      <button type="submit" class="action" aria-pressed=${blurt.viewerLikes ? 'true' : 'false'}>
        <${Icon} name="heart" /><span>${blurt.viewerLikes ? 'Unlike' : 'Like'}</span>
      </button>
      <span class="like-count">${count}</span>
    </form>
  `
}

// The count for everyone; a Reblurt / Undo reblurt button where reblurtAction allows one.
// Quoting is a link to the quote form on the blurt's page.
function Reblurts({ blurt, viewer }: { blurt: Blurt; viewer: Viewer }) {
  const count = html`<span class="like-count">${plural(blurt.reblurtCount, 'reblurt')}</span>`
  const action = reblurtAction(viewer, blurt)
  const quote =
    viewer &&
    html`<a href=${quoteUrl(blurt)} class="action"><${Icon} name="quote" /><span>Quote</span></a>`
  if (!action) {
    return html`<span class="action-count"><${Icon} name="reblurt" />${count}</span> ${quote}`
  }
  return html`
    <form method="post" action="/api/${action}" class="like-form">
      <input type="hidden" name="blurtId" value=${blurt.id} />
      <button
        type="submit"
        class="action"
        aria-pressed=${action === 'unreblurt' ? 'true' : 'false'}
      >
        <${Icon} name="reblurt" /><span
          >${action === 'unreblurt' ? 'Undo reblurt' : 'Reblurt'}</span
        >
      </button>
      ${count}
    </form>
    ${quote}
  `
}

// In the viewer's time zone (UTC until they pick one) and the clock their browser's
// language uses. `datetime` stays UTC.
function Timestamp({ date }: { date: Date }) {
  const { timeZone, locale } = pageContext()
  return html`<time datetime=${date.toISOString()}
    >${formatTimestamp(date, timeZone, locale)}</time
  >`
}

// The blurt a quote quotes, under its text: one level, so a quote in it shows only its own
// text. A deleted one says so, and nothing else.
function QuotedCard({ quoted }: { quoted: QuotedBlurt }) {
  if (quoted.deleted) {
    return html`<blockquote class="quoted"><p class="empty">Content is deleted.</p></blockquote>`
  }
  return html`
    <blockquote class="quoted">
      <div class="blurt-meta">
        <strong><a href="/${quoted.username}/">${quoted.username}</a></strong>
        <a href=${blurtUrl(quoted)}><${Timestamp} date=${quoted.createdAt} /></a>
      </div>
      <p>${renderBlurtText(quoted.text ?? '')}</p>
    </blockquote>
  `
}

function ReplyingTo({ blurt }: { blurt: Blurt }) {
  const url = parentUrl(blurt)
  return (
    url &&
    html`<p class="replying-to">
      Replying to <a href=${url}>${blurt.parentUsername ?? 'a deleted blurt'}</a>
    </p>`
  )
}

// Two clicks, no JS: the <details> opens the form, its button deletes for good.
function DeleteForm({ blurt }: { blurt: Blurt }) {
  return html`
    <details class="blurt-action">
      <summary><${Icon} name="trash" /><span>Delete</span></summary>
      <form method="post" action=${deleteBlurtPath(blurt)} class="inline-form">
        <span>Delete this blurt for good?</span>
        <button type="submit" class="danger">Delete</button>
      </form>
    </details>
  `
}

function ReportForm({ blurt, error }: { blurt: Blurt; error?: string }) {
  return html`
    <details class="blurt-action" open=${Boolean(error)}>
      <summary><${Icon} name="flag" /><span>Report</span></summary>
      <form method="post" action="/api/report" class="inline-form">
        <${ValidationError} message=${error} />
        <input type="hidden" name="blurtId" value=${blurt.id} />
        <label>Reason (optional) <input name="reason" maxlength=${reportReasonMaxLength} /></label>
        <button type="submit" class="danger">Report</button>
      </form>
    </details>
  `
}

// `replies` are shown inline (the feed); the link below covers the rest of the thread.
// `viewer` decides the Delete / Report actions; `reported` says the viewer already did.
// `inThread`: shown under (or as) the blurt it replies to, so "Replying to" is left out.
// A plain reblurt in a list is its original with "Reblurted by" on top; every button acts
// on the original.
function BlurtCard({
  blurt,
  viewer = null,
  replies = [],
  showActions = true,
  inThread = false,
  reported = false,
  reportError,
  sharePath,
}: {
  blurt: Blurt
  viewer?: Viewer
  replies?: Blurt[]
  showActions?: boolean
  inThread?: boolean
  reported?: boolean
  reportError?: string
  // What Share opens: the blurt's page, or on the blurt's own page its card image.
  sharePath?: string
}) {
  const hiddenReplies = blurt.replyCount - replies.length
  const threadLink =
    hiddenReplies <= 0
      ? blurt.deleted
        ? 'Thread'
        : 'Reply'
      : replies.length > 0
        ? plural(hiddenReplies, 'more reply', 'more replies')
        : plural(hiddenReplies, 'reply', 'replies')
  const threadIcon: IconName = hiddenReplies <= 0 && !blurt.deleted ? 'reply' : 'thread'
  const action = blurtActions(viewer, blurt)
  const replyCards =
    replies.length > 0 &&
    html`<div class="replies">
      ${replies.map((reply) => html`<${BlurtCard} blurt=${reply} viewer=${viewer} inThread />`)}
    </div>`

  if (blurt.deleted) {
    return html`
      <article class="blurt deleted">
        <div class="blurt-body">
          <div class="blurt-meta">
            <em>Deleted</em>
            <a href=${blurtUrl(blurt)}><${Timestamp} date=${blurt.createdAt} /></a>
          </div>
          <p class="empty">This blurt was deleted.</p>
          ${replyCards}
          ${
            showActions &&
            html`<div class="blurt-actions">
              <a href=${blurtUrl(blurt)} class="action"
                ><${Icon} name=${threadIcon} /><span>${threadLink}</span></a
              >
            </div>`
          }
        </div>
      </article>
    `
  }

  // The avatar sits on the left of odd blurts and the right of even ones (CSS).
  return html`
    <article class=${blurt.reblurtedBy ? 'blurt reblurt' : 'blurt'} id=${blurtAnchor(blurt)}>
      <${AvatarSvg} avatar=${blurt.avatar} />
      <div class="blurt-body">
        ${
          blurt.reblurtedBy &&
          html`<p class="reblurted-by">
            Reblurted by <a href="/${blurt.reblurtedBy}/">${blurt.reblurtedBy}</a>
          </p>`
        }
        ${!inThread && html`<${ReplyingTo} blurt=${blurt} />`}
        <div class="blurt-meta">
          <strong><a href="/${blurt.username}/">${blurt.username}</a></strong>
          <a href=${blurtUrl(blurt)}><${Timestamp} date=${blurt.createdAt} /></a>
        </div>
        <p>${renderBlurtText(blurt.text ?? '')}</p>
        ${
          blurt.picture &&
          html`<img
            class="blurt-picture"
            src="/pictures/${blurt.id}.svg"
            width=${blurt.picture.width}
            height=${blurt.picture.height}
            alt="Picture"
            loading="lazy"
          />`
        }
        ${blurt.quoted && html`<${QuotedCard} quoted=${blurt.quoted} />`}
        <div class="blurt-actions">
          ${
            showActions &&
            html`<a href=${blurtUrl(blurt)} class="action"
              ><${Icon} name=${threadIcon} /><span>${threadLink}</span></a
            >`
          }
          <${Likes} blurt=${blurt} viewer=${viewer} />
          <${Reblurts} blurt=${blurt} viewer=${viewer} />
          <a href=${sharePath ?? blurtUrl(blurt)} class="action"
            ><${Icon} name="share" /><span>Share</span></a
          >
          ${action === 'delete' && html`<${DeleteForm} blurt=${blurt} />`}
          ${
            action === 'report' &&
            (reported
              ? html`<span class="empty">You reported this blurt.</span>`
              : html`<${ReportForm} blurt=${blurt} error=${reportError} />`)
          }
        </div>
        ${replyCards}
      </div>
    </article>
  `
}

// Related blurts, in the thread page's aside: just enough to pick one.
function RelatedList({ blurts }: { blurts: Blurt[] }) {
  return html`
    <ul class="related">
      ${blurts.map(
        (blurt) => html`
          <li>
            <a href=${blurtUrl(blurt)}
              >${blurt.deleted ? 'A deleted blurt' : preview(blurt.text, 90)}</a
            >
            ${blurt.username && html`<span class="tiny"> · ${blurt.username}</span>`}
          </li>
        `,
      )}
    </ul>
  `
}

type BlurtPageProps = BlurtPageData & { composer?: ComposerProps; reportError?: string }

function BlurtPage({
  viewer,
  blurt,
  parent,
  reported,
  replies,
  next,
  related,
  composer,
  reportError,
  cardColor = null,
}: BlurtPageProps) {
  const cardPath = blurtCardPath(blurt, cardColor)
  const quoting = composer?.reblurtOfId !== undefined
  const aside = html`
    ${
      viewer &&
      !blurt.deleted &&
      html`<${Composer}
        ...${quoting ? composer : {}}
        id="quote"
        reblurtOfId=${blurt.id}
        heading="Quote"
        label="Your take, with this blurt under it"
        placeholder="Your take, with this blurt under it"
        button="Quote it"
      />`
    }
    <section class="panel" aria-label="Related blurts">
      <h3>Related blurts</h3>
      ${
        related.length > 0
          ? html`<${RelatedList} blurts=${related} />`
          : html`<p class="empty">Nothing related yet.</p>`
      }
    </section>
  `
  return html`
    <${Page}
      title=${blurt.username ?? 'Deleted blurt'}
      tagline="One blurt, its replies, and related chaos."
      aside=${aside}
    >
      ${
        parent &&
        html`<section class="panel" aria-label="In reply to">
          <h2>In reply to</h2>
          <${BlurtCard} blurt=${parent} viewer=${viewer} />
        </section>`
      }
      <section class="panel thread-main" aria-label="Blurt">
        <${BlurtCard}
          blurt=${blurt}
          viewer=${viewer}
          showActions=${false}
          inThread
          reported=${reported}
          reportError=${reportError}
          sharePath=${cardPath}
        />
      </section>
      ${
        blurt.deleted
          ? null
          : viewer
            ? html`<${Composer}
                ...${quoting ? {} : (composer ?? {})}
                parentId=${blurt.id}
                heading="Reply"
                label="Reply"
                placeholder="Reply to this blurt…"
                button="Reply"
              />`
            : html`<${AnonymousActions} heading="Reply" />`
      }
      <section class="panel" aria-label="Replies">
        <h2>Replies</h2>
        <div class="thread-children">
          ${
            replies.length > 0
              ? replies.map(
                  (reply) => html`<${BlurtCard} blurt=${reply} viewer=${viewer} inThread />`,
                )
              : html`<p class="empty">No replies yet.</p>`
          }
        </div>
        ${next && html`<${NextPageLink} href=${moreRepliesUrl(blurt, next)} label="More replies" />`}
      </section>
    <//>
  `
}

// The admin tools: one form per admin API.
function AdminToolsPage({ minted }: AdminToolsData) {
  return html`
    <${Page} title="Admin" tagline="Tools for moderators.">
      <section class="panel" aria-label="Reports">
        <h2>Reports</h2>
        <p>Blurts that people have reported.</p>
        <div class="actions">
          <${ButtonLink} href="/admin/reports" icon="flag" label="Open reports" />
        </div>
      </section>
      <section class="panel" aria-label="Delete a blurt">
        <h2>Delete a blurt</h2>
        <form method="post" action="/api/admin/blurts/delete">
          <label
            >Blurt id <input name="blurtId" inputmode="numeric" pattern="[0-9]+" required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="trash" label="Delete blurt" kind="danger" />
          </div>
        </form>
      </section>
      <section class="panel" aria-label="Dismiss reports">
        <h2>Dismiss reports</h2>
        <p class="tiny">Closes every open report on the blurt, which stays up.</p>
        <form method="post" action="/api/admin/reports/dismiss">
          <label
            >Blurt id <input name="blurtId" inputmode="numeric" pattern="[0-9]+" required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="shield" label="Dismiss reports" kind="secondary" />
          </div>
        </form>
      </section>
      <section class="panel" aria-label="Mint invite codes">
        <h2>Mint invite codes</h2>
        <p class="tiny">The codes belong to the user and are listed on their profile.</p>
        ${
          minted &&
          html`<div role="status">
            <p>${plural(minted.codes.length, 'code', 'codes')} for ${minted.username}:</p>
            <pre>${minted.codes.join('\n')}</pre>
          </div>`
        }
        <form method="post" action="/api/admin/invites">
          <label>Owner's username <input name="username" required /></label>
          <label
            >How many (1–1000)
            <input name="count" type="number" min="1" max="1000" value="10" required
          /></label>
          <label
            >Days until they expire (empty: never)
            <input name="days" type="number" min="1" step="1"
          /></label>
          <div class="actions">
            <${SubmitButton} icon="personPlus" label="Mint codes" />
          </div>
        </form>
      </section>
    <//>
  `
}

// Moderation: blurts with open reports, each with Delete and Dismiss buttons.
function AdminReportsPage({ reports }: AdminReportsData) {
  return html`
    <${Page} title="Reports" tagline="Open reports, the one waiting longest first.">
      ${
        reports.length > 0
          ? reports.map(
              ({ blurt, reports: open }) => html`
                <section class="panel report" aria-label="Reported blurt ${blurt.id}">
                  <${BlurtCard} blurt=${blurt} />
                  <ul>
                    ${open.map(
                      (report) =>
                        html`<li>
                          <a href="/${report.reporter}/">${report.reporter}</a>${': '}${
                            report.reason || html`<span class="empty">no reason given</span>`
                          }
                        </li>`,
                    )}
                  </ul>
                  <div class="actions">
                    <form method="post" action=${deleteBlurtPath(blurt)} class="inline">
                      <${SubmitButton} icon="trash" label="Delete blurt" kind="danger" />
                    </form>
                    <form method="post" action="/api/admin/reports/dismiss" class="inline">
                      <input type="hidden" name="blurtId" value=${blurt.id} />
                      <${SubmitButton} icon="shield" label="Dismiss" kind="secondary" />
                    </form>
                  </div>
                </section>
              `,
            )
          : html`<section class="panel"><p class="empty">No open reports.</p></section>`
      }
    <//>
  `
}

function renderSocial(value: string): unknown {
  if (!value) {
    return html`<span class="empty">Not set</span>`
  }

  if (isWebUrl(value)) {
    const url = normalizedWebUrl(value) ?? value
    return html`<a href=${url} rel="noreferrer noopener nofollow ugc" referrerpolicy="no-referrer"
      >${url}</a
    >`
  }

  return html`<span>${value}</span>`
}

const socialFields = [
  ['homepage', 'Homepage'],
  ['x', 'X'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['github', 'GitHub'],
  ['linkedin', 'LinkedIn'],
] as const

function ProfileLinks({ profile }: { profile: UserProfile }) {
  return html`
    <section class="panel" aria-label="Links">
      <h3>Links</h3>
      <dl class="profile-data">
        ${socialFields.map(
          ([key, label]) =>
            html`<dt>${label}</dt>
              <dd>${renderSocial(profile[key])}</dd>`,
        )}
      </dl>
    </section>
  `
}

// Opt-in, coarse location. Clicking the map image submits the pixel (location.x,
// location.y) with no JS; the server snaps it to a grid cell. The number fields are the
// fallback for keyboards, which can't click a spot. The marker shows exactly what is stored.
function LocationForms({ location, error }: { location: GeoPoint | null; error?: string }) {
  const marker = location && pointToPixel(location)
  return html`
    <section class="panel" aria-label="Location" id="location">
      <h2>Location</h2>
      <p>
        Optional. Set it to see <a href="/near">blurts near you</a>. Only ${gridDescription} is
        stored, never the exact spot, and nobody else can see it.
      </p>
      <${ValidationError} message=${error} />
      <p class="location-status">
        ${
          location
            ? html`${'Your location: '}<strong>${formatLocation(location)}</strong>${` (the middle of ${gridDescription}).`}`
            : "You haven't set a location."
        }
      </p>
      <form method="post" action="/api/location" class="map-form">
        <div class="map">
          <div class="map-inner">
            <input
              type="image"
              name="location"
              src=${mapUrl}
              width=${mapWidth}
              height=${mapHeight}
              alt="World map: click to set your location"
            />
            ${
              marker &&
              html`<svg
                class="map-marker"
                width=${mapWidth}
                height=${mapHeight}
                viewBox="0 0 ${mapWidth} ${mapHeight}"
                aria-hidden="true"
                focusable="false"
              >
                <circle
                  cx=${marker.x}
                  cy=${marker.y}
                  r="6"
                  fill="#a32020"
                  stroke="#fffdf8"
                  stroke-width="2"
                />
              </svg>`
            }
          </div>
        </div>
      </form>
      <form method="post" action="/api/location" class="field-row">
        <label
          >Latitude (-90 to 90, south is negative)
          <input
            type="number"
            name="lat"
            min="-90"
            max="90"
            step="any"
            required
            value=${location?.lat ?? ''}
          />
        </label>
        <label
          >Longitude (-180 to 180, west is negative)
          <input
            type="number"
            name="lon"
            min="-180"
            max="180"
            step="any"
            required
            value=${location?.lon ?? ''}
          />
        </label>
        <div class="actions"><${SubmitButton} icon="pin" label="Set location" /></div>
      </form>
      ${
        location &&
        html`<form method="post" action="/api/location" class="inline">
          <input type="hidden" name="clear" value="1" />
          <${SubmitButton} icon="trash" label="Remove my location" kind="secondary" />
        </form>`
      }
    </section>
  `
}

function TypeSelect<T extends string>({
  name,
  label,
  types,
  value,
}: {
  name: keyof Avatar
  label: string
  types: readonly T[]
  value: T
}) {
  return html`<label
    >${label}
    <select name=${name}>
      ${types.map(
        (type) =>
          html`<option value=${type} selected=${type === value}>${avatarLabels[type]}</option>`,
      )}
    </select>
  </label>`
}

function ColorInput({ name, label, value }: { name: keyof Avatar; label: string; value: string }) {
  return html`<label class="color-field"
    >${label} <input type="color" name=${name} value=${value} required
  /></label>`
}

// One plain form: "Save avatar" sends the choices, "Random" (name="random") makes the
// server pick a new random avatar instead. Both work without JS.
function AvatarForm({ avatar, error }: { avatar: Avatar; error?: string }) {
  return html`
    <section class="panel" aria-label="Avatar" id="avatar">
      <h2>Avatar</h2>
      <${ValidationError} message=${error} />
      <form method="post" action="/api/avatar" class="avatar-form">
        <div class="avatar-preview">
          <${AvatarSvg} avatar=${avatar} label="Your avatar" size="large" />
          <p class="empty">Hover it to hear it talk.</p>
        </div>
        <div class="avatar-fields">
          <${TypeSelect}
            name="headWidth"
            label="Head"
            types=${headWidths}
            value=${avatar.headWidth ?? 'regular'}
          />
          <${ColorInput} name="skin" label="Skin colour" value=${avatar.skin} />
          <${TypeSelect} name="hairType" label="Hair" types=${hairTypes} value=${avatar.hairType} />
          <${ColorInput} name="hairColor" label="Hair colour" value=${avatar.hairColor} />
          <${TypeSelect} name="eyeType" label="Eyes" types=${eyeTypes} value=${avatar.eyeType} />
          <${ColorInput} name="eyeColor" label="Eye colour" value=${avatar.eyeColor} />
          <${ColorInput} name="pupilColor" label="Pupil colour" value=${avatar.pupilColor} />
          <${TypeSelect}
            name="toothType"
            label="Teeth"
            types=${toothTypes}
            value=${avatar.toothType}
          />
          <${ColorInput} name="toothColor" label="Tooth colour" value=${avatar.toothColor} />
        </div>
        <div class="actions avatar-buttons">
          <button type="submit"><${Icon} name="save" /><span>Save avatar</span></button>
          <button type="submit" name="random" value="1" formnovalidate>Random</button>
        </div>
      </form>
    </section>
  `
}

// The colour theme, for this browser (a cookie, see src/themes.ts). Each choice shows a
// strip of its colours (classes in public/style.css), so no JS is needed to preview.
function ThemeForm() {
  const current = pageContext().theme
  return html`
    <section class="panel" aria-label="Theme" id="theme">
      <h2>Theme</h2>
      <p class="tiny">Saved on your account, so it follows you to every device.</p>
      <form method="post" action="/api/theme">
        <fieldset class="theme-choices">
          <legend class="visually-hidden">Theme</legend>
          ${themes.map(
            ({ id, label }) => html`
              <label class="theme-choice">
                <input type="radio" name="theme" value=${id} checked=${id === current} required />
                <span class="swatch swatch-${id}" aria-hidden="true"
                  ><span></span><span></span><span></span><span></span
                ></span>
                <span>${label}</span>
              </label>
            `,
          )}
        </fieldset>
        <div class="actions"><${SubmitButton} icon="palette" label="Use this theme" /></div>
      </form>
    </section>
  `
}

// The time zone and language of dates and times. <select>s, so no JS is needed.
function TimeZoneForm() {
  const { timeZone: current, pickedLocale: locale } = pageContext()
  return html`
    <section class="panel" aria-label="Time zone" id="timezone">
      <h2>Time zone and language</h2>
      <p class="tiny">
        Times are shown in UTC until you pick your time zone. The language decides how dates and
        times are written (17.10.2026 14:37 or 10/17/2026 02:37 PM); until you pick one, your
        browser's language is used. Saved on your account, so it follows you to every device.
      </p>
      <form method="post" action="/api/timezone">
        <label>
          Time zone
          <select name="timezone" required>
            ${timeZones.map(
              (zone) => html`<option value=${zone} selected=${zone === current}>${zone}</option>`,
            )}
          </select>
        </label>
        <label>
          Language
          <select name="locale">
            <option value="" selected=${locale === null}>Same as my browser</option>
            ${locales.map(
              (id) =>
                html`<option value=${id} selected=${id === locale}>${localeLabel(id)}</option>`,
            )}
          </select>
        </label>
        <div class="actions"><${SubmitButton} icon="save" label="Save time settings" /></div>
      </form>
    </section>
  `
}

// The colour of the share cards. Its inputs and button belong to the profile form above
// (the `form` attribute), so one POST saves everything and no JavaScript is needed.
function CardForm({ profile }: { profile: UserProfile }) {
  const cardPath = profileCardPath(profile)
  return html`
    <section class="panel" aria-label="Share card" id="card">
      <h2>Share card</h2>
      <p class="tiny">
        The image shown when your profile or blurts are shared. Your profile's card shows the first
        ${blurtMaxLength} characters of your bio.
      </p>
      <fieldset class="theme-choices">
        <legend>Share card colour</legend>
        ${cardColors.map(
          ({ id, label }) => html`
            <label class="theme-choice">
              <input
                type="radio"
                name="cardColor"
                form="profile-form"
                value=${id}
                checked=${id === (profile.cardColor ?? cardColors[0].id)}
              />
              <span class="swatch card-swatch-${id}" aria-hidden="true"><span></span></span>
              <span>${label}</span>
            </label>
          `,
        )}
      </fieldset>
      <div class="actions">
        <button type="submit" form="profile-form">
          <${Icon} name="save" /><span>Save profile and colour</span>
        </button>
        ${
          cardPath
            ? html`<${ButtonLink}
                href=${cardPath}
                icon="share"
                label="Open card image"
                kind="secondary"
              />`
            : html`<span class="tiny">Write a bio to get a profile card.</span>`
        }
      </div>
    </section>
  `
}

function ProfileEditForm({
  profile,
  location,
  validationError,
  locationError,
  avatarError,
}: ProfileEditProps) {
  const aside = html`
    <${LinkPanel}
      title="On this page"
      links=${[
        ['#profile', 'Profile and links'],
        ['#card', 'Share card'],
        ['#avatar', 'Avatar'],
        ['#location', 'Location'],
        ['#theme', 'Theme'],
      ]}
    />
    <${LinkPanel}
      title="Elsewhere"
      links=${[
        [`/${profile.username}/`, 'Your profile'],
        ['/settings', 'Account settings'],
      ]}
    />
  `
  return html`
    <${Page}
      title=${`Edit profile: ${profile.username}`}
      tagline="Identity, looks, whereabouts and colours."
      actions=${html`<${ButtonLink}
        href=${`/${profile.username}/`}
        icon="back"
        label="Back to profile"
      />`}
      aside=${aside}
    >
      <section class="panel" aria-label="Profile" id="profile">
        <h2>Profile</h2>
        <form method="post" action="/${profile.username}/edit" id="profile-form">
          ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
          <label
            >Bio
            <textarea name="bio" maxlength=${bioMaxLength} placeholder="Say the thing.">
${profile.bio}</textarea>
          </label>
          <div class="field-grid">
            <label
              >Homepage
              <input
                name="homepage"
                maxlength=${linkMaxLength}
                value=${profile.homepage}
                placeholder="https://example.com"
              />
            </label>
            ${socialFields
              .filter(([key]) => key !== 'homepage')
              .map(
                ([key, label]) =>
                  html`<label
                    >${label}
                    <input
                      name=${key}
                      maxlength=${linkMaxLength}
                      value=${profile[key]}
                      placeholder="@handle or full URL"
                    />
                  </label>`,
              )}
          </div>
          <div class="actions"><${SubmitButton} icon="save" label="Save profile" /></div>
        </form>
      </section>
      <${CardForm} profile=${profile} />
      <${AvatarForm} avatar=${profile.avatar} error=${avatarError} />
      <${LocationForms} location=${location} error=${locationError} />
      <${ThemeForm} />
      <${TimeZoneForm} />
    <//>
  `
}

function FeedTabs({ feed }: { feed: FeedData['feed'] }) {
  return html`
    <nav class="panel tabs" aria-label="Feeds">
      <a href="/" aria-current=${feed === 'following' ? 'page' : undefined}>Following</a>
      <a href="/everyone" aria-current=${feed === 'everyone' ? 'page' : undefined}>Everyone</a>
    </nav>
  `
}

function Discovery({ section, viewer }: { section: DiscoverySection; viewer: Viewer }) {
  const { title, description } = discoveryTitles[section.kind]
  return html`
    <section aria-label=${title} class="discovery">
      <h2>${title}</h2>
      <p class="discovery-description">${description}</p>
      ${section.blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)}
    </section>
  `
}

// The feed pages' aside: shortcuts for logged-in viewers, the way in for everyone else.
function FeedAside({ viewer }: { viewer: Viewer }) {
  if (!viewer) {
    return html`
      <section class="panel">
        <h3>What is this?</h3>
        <p>
          Short posts, blurts, of up to ${blurtMaxLength} characters. No ads, no tracking, no
          JavaScript, no email address needed.
        </p>
        <div class="actions">
          <${ButtonLink} href="/createUser" icon="personPlus" label="Sign up" kind="" />
          <${ButtonLink} href="/login" icon="login" label="Log in" />
        </div>
      </section>
      <${SupportLinks} />
    `
  }
  return html`
    <${LinkPanel}
      title="Your corner"
      links=${[
        [`/${viewer.username}/`, 'Your profile'],
        [`/${viewer.username}/edit`, 'Edit profile, avatar and theme'],
        ['/near', 'Blurts near you'],
        ['/search', 'Search people and blurts'],
        ['/settings', 'Account settings'],
      ]}
    />
    <${SupportLinks} />
  `
}

function FeedPage(data: FeedData & { composer?: ComposerProps }) {
  const { viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next, composer } = data
  const cards = (items: FeedItem[]) =>
    items.map(
      (blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} replies=${blurt.replies} />`,
    )
  const discoverySections = (count: number) =>
    discoveryAfter(discovery, count).map(
      (section) => html`<${Discovery} section=${section} viewer=${viewer} />`,
    )
  const everyonePage = feed === 'everyone' && hasFollowingFeed

  return html`
    <${Page}
      title=${everyonePage ? 'Everyone' : 'blurt.trade'}
      tagline=${everyonePage ? 'Every blurt, newest first.' : siteDescription}
      aside=${html`<${FeedAside} viewer=${viewer} />`}
    >
      ${viewer ? html`<${Composer} ...${composer ?? {}} />` : html`<${AnonymousActions} />`}
      ${hasFollowingFeed && html`<${FeedTabs} feed=${feed} />`}
      ${
        followedBlurts.length > 0 &&
        html`<section aria-label="From people you follow" class="panel followed">
          <h2>From people you follow</h2>
          ${cards(followedBlurts)}
        </section>`
      }
      <section aria-label="Blurts" class="panel">
        <h2>${feed === 'following' ? 'Following' : 'Everyone'}</h2>
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
    <//>
  `
}

function NearPage({ viewer, location, radius, radii, blurts, next }: NearData) {
  const edit = `/${viewer.username}/edit`
  return html`
    <${Page}
      title="Blurts near you"
      tagline="What people around you are blurting."
      actions=${html`<${ButtonLink}
        href=${`${edit}#location`}
        icon="pin"
        label="Change location"
      />`}
      aside=${html`
        <section class="panel">
          <h3>Local context</h3>
          <p class="tiny">
            Only ${gridDescription} is stored for anyone, never the exact spot, and nobody sees
            yours. Set or remove it on <a href=${`${edit}#location`}>your edit page</a>.
          </p>
        </section>
        <${SupportLinks} />
      `}
    >
      <${Composer} heading="Blurt from your area" placeholder="Local thought? Share it." />
      ${
        location
          ? html`
              <section class="panel" aria-label="Radius">
                <h2>Radius</h2>
                <p>
                  From people within ${radius} km of ${formatLocation(location)}.${' '}
                  <a href=${edit}>Change your location</a>
                </p>
                <form method="get" action="/near" class="radius-form">
                  <label
                    >Radius
                    <select name="radius">
                      ${radii.map(
                        (km) =>
                          html`<option value=${km} selected=${km === radius}>${km} km</option>`,
                      )}
                    </select>
                  </label>
                  <${SubmitButton} icon="pin" label="Show" kind="secondary" />
                </form>
              </section>
              <section aria-label="Blurts" class="panel">
                <h2>Nearby blurts</h2>
                ${
                  blurts.length > 0
                    ? blurts.map(
                        (blurt) =>
                          html`<${BlurtCard}
                            blurt=${blurt}
                            viewer=${viewer}
                            replies=${blurt.replies}
                          />`,
                      )
                    : html`<p class="empty">Nobody near you has blurted yet.</p>`
                }
                ${
                  next &&
                  html`<${NextPageLink} href=${nearPageUrl(radius, next)} label="Older blurts" />`
                }
              </section>
            `
          : html`<section class="panel">
              <p>
                You haven't set a location.${' '}
                <a href=${edit}>Click the map on your edit page</a> to see blurts from people near
                you.
              </p>
            </section>`
      }
    <//>
  `
}

function FollowForm({ username, following }: { username: string; following: boolean }) {
  return html`
    <form method="post" action=${following ? '/api/unfollow' : '/api/follow'} class="follow-form">
      <input type="hidden" name="username" value=${username} />
      <button type="submit" class=${following ? 'secondary' : undefined}>
        <${Icon} name=${following ? 'personMinus' : 'personPlus'} /><span
          >${following ? 'Unfollow' : 'Follow'}</span
        >
      </button>
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
    <section class="panel" aria-label="Your invite codes">
      <h3>Your invite codes</h3>
      <p class="tiny">Each code lets one person sign up, even while blurt.trade is invite-only.</p>
      ${
        items.length > 0
          ? html`<ul class="list invite-codes">
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
  const own = viewer?.id === profile.userId
  const feed = blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)
  const cardPath = profileCardPath(profile)
  const actions =
    cardPath || own || viewer
      ? html`
          ${cardPath && html`<${ShareLink} href=${cardPath} />`}
          ${
            own
              ? html`<${ButtonLink}
                  href="/${profile.username}/edit"
                  icon="edit"
                  label="Edit profile"
                />`
              : viewer &&
                html`<${FollowForm}
                  username=${profile.username}
                  following=${follows.viewerFollows}
                />`
          }
        `
      : undefined

  return html`
    <${Page}
      title=${profile.username}
      tagline=${`${plural(follows.followerCount, 'follower')} · ${follows.followingCount} following`}
      lead=${html`<${AvatarSvg}
        avatar=${profile.avatar}
        label="${profile.username}'s avatar"
        size="large"
      />`}
      actions=${actions}
      aside=${html`
        <${ProfileLinks} profile=${profile} />
        ${inviteCodes && html`<${InviteCodes} codes=${inviteCodes} />`}
      `}
    >
      <section class="panel" aria-label="Profile">
        <h2>Profile</h2>
        ${invitedBy && html`<p class="invited-by">Invited by <a href="/${invitedBy}/">${invitedBy}</a></p>`}
        <p class="bio">${profile.bio || html`<span class="empty">No bio yet.</span>`}</p>
      </section>
      <section class="panel" aria-label="${profile.username} blurts">
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
    <//>
  `
}

// How to reach the owner privately, or a note that no address is set up.
function PrivateContact({ contact }: { contact: Contact }) {
  return contact.email
    ? html`email <a href=${`mailto:${contact.email}`}>${contact.email}</a>`
    : html`the contact on the <a href="/about">About page</a>`
}

// About, Terms and Privacy: one panel of text.
function InfoPage({
  title,
  tagline,
  children,
}: {
  title: string
  tagline: string
  children?: ComponentChildren
}) {
  return html`
    <${Page} title=${title} tagline=${tagline} aside=${html`<${SupportLinks} />`}>
      <section class="panel prose">${children}</section>
    <//>
  `
}

function AboutPage({ contact }: InfoPageData) {
  const { email, issuesUrl, securityUrl } = contact
  return html`
    <${InfoPage} title="About blurt.trade" tagline="A small hobby site for blurting.">
      <p>
        blurt.trade is a small hobby site for short posts, blurts, of up to ${blurtMaxLength}
        characters. It works without JavaScript, has no ads and no tracking, and collects as little
        about you as it can: see <a href="/privacy">Privacy</a> and <a href="/terms">Terms</a>.
      </p>
      <section aria-label="Contact">
        <h2>Contact</h2>
        ${
          issuesUrl &&
          html`<p>Questions, bugs and ideas: open an issue on <a href=${issuesUrl}>GitHub</a>.</p>`
        }
        ${email && html`<p>Anything that shouldn't be public: <a href=${`mailto:${email}`}>${email}</a>.</p>`}
        ${!issuesUrl && !email && html`<p>No contact address has been set up yet.</p>`}
        ${
          issuesUrl &&
          html`<p>
              <strong>GitHub issues are public</strong>: anyone can read them. Never put these in
              one:
            </p>
            <ul>
              <li>
                A security hole:
                ${
                  securityUrl
                    ? html`report it privately with GitHub's
                        <a href=${securityUrl}>Report a vulnerability</a
                        >${email ? ', or by email' : ''}.`
                    : 'email it.'
                }
              </li>
              <li>
                Illegal content, or someone's private information posted here: use the Report button
                on the blurt (when you're logged in)${email ? ', or email' : ''}. Don't repeat the
                content or the information anywhere public.
              </li>
              <li>
                Anything about your own account or data:
                ${email ? html`<a href=${`mailto:${email}`}>email</a>` : 'ask without details'}.
              </li>
            </ul>`
        }
      </section>
    <//>
  `
}

function TermsPage({ contact }: InfoPageData) {
  return html`
    <${InfoPage} title="Terms" tagline="Short on purpose.">
      <p>By using blurt.trade you agree to these terms. They're short on purpose.</p>
      <h2>Your posts</h2>
      <p>
        You're responsible for what you post. Everything you post is public: blurts, replies and
        your profile. You keep the rights to it, and let blurt.trade show it, which is the point.
      </p>
      <h2>What's not allowed</h2>
      <p>
        Nothing illegal. No harassment, no threats, no spam, and no one else's private information.
        Don't try to break the site or get around its limits.
      </p>
      <h2>Removal</h2>
      <p>
        The owner can remove any blurt or profile, and close any account, at any time and without
        notice, for example when it breaks these terms.
      </p>
      <h2>Your password</h2>
      <p>${noPasswordReset}</p>
      <h2>No warranty</h2>
      <p>
        blurt.trade is a hobby project, provided as it is, with no warranty of any kind. It may be
        down, lose data, change or shut down. As far as the law allows, the owner isn't liable for
        any loss from using it.
      </p>
      <h2>Changes</h2>
      <p>
        These terms may change; this page always has the current version. Questions:
        <${PrivateContact} contact=${contact} />.
      </p>
    <//>
  `
}

function PrivacyPage({ contact }: InfoPageData) {
  return html`
    <${InfoPage} title="Privacy" tagline="As little as we can.">
      <p>
        blurt.trade collects as little as it can. No email address, no real name, no phone number.
        No analytics, no ads, no tracking, and nothing loaded from other sites.
      </p>
      <h2>What is stored</h2>
      <p>For each account:</p>
      <ul>
        <li>
          Your username, a hash of your password (Argon2id: the password itself is never stored),
          and when you signed up.
        </li>
        <li>
          The profile fields you fill in: bio, homepage and social links, your avatar's settings,
          the colour theme and share card colour you picked.
        </li>
        <li>
          Only if you set it: a coarse location, ${gridDescription}. Only you see it, but it puts
          your blurts in "Near you" for people nearby.
        </li>
        <li>
          Your blurts and replies, with when you posted them, and for each one an embedding: numbers
          describing what it's about, for related blurts and "You might like". It's computed on our
          own server; your text isn't sent anywhere.
        </li>
        <li>
          If you attach one, a blurt's picture: only a rough drawing of it, made on our own server.
          The photo you upload is never stored.
        </li>
        <li>Who you follow.</li>
        <li>
          Blurts you like, and when. Only the number of likes on a blurt is public: nobody else sees
          who liked it.
        </li>
        <li>
          Blurts you reblurt, and when. Reblurts are public: they show on your profile and in your
          followers' feeds. A quote is a blurt of your own, with the quoted blurt under it.
        </li>
        <li>
          Your invite codes, and who signed up with them. Who invited you shows on your profile.
        </li>
        <li>Blurts you report, with your reason and when.</li>
        <li>
          Your sessions: one record per login, with when it started and was last used. No IP address
          and no browser details.
        </li>
      </ul>
      <p>
        The waitlist stores only the username you'd like, whether you've signed up since, and when
        you joined it.
      </p>
      <p>
        For deleted accounts, only the username is kept, in lower case and with nothing else, so it
        can't be taken again.
      </p>
      <p>
        Public: your username, profile, avatar, blurts, reblurts, follower, like and reblurt counts,
        and who invited you. Everything else is private, though admins see who reported what.
      </p>
      <h2>What is not stored</h2>
      <ul>
        <li>
          No email address. So we can't contact you, and there's <strong>no password reset</strong>:
          a lost password can't be recovered, and neither can the account.
        </li>
        <li>
          No IP addresses in the database or in the app's logs. Rate limiting counts requests per IP
          address in memory only, until the limit has refilled (an hour at most), and never writes
          them down. The web server's access log keeps addresses shortened (the last part dropped)
          for at most 14 days, to spot abuse.
        </li>
        <li>
          The app's logs hold what was asked for and how it went (method, path, status, time), never
          what you posted, your password or your cookies.
        </li>
      </ul>
      <h2>Cookies</h2>
      <p>
        Three, all needed for the site to work, none for tracking, so there's no cookie banner. All
        are HttpOnly and only sent to blurt.trade.
      </p>
      <ul>
        <li>
          <code>access_token</code>: shows you're logged in, and which colour theme you picked.
          Lasts 5 minutes.
        </li>
        <li>
          <code>refresh_token</code>: keeps you logged in. Renewed as you use the site; expires
          after 400 days without a visit, or when you log out.
        </li>
        <li>
          <code>recent_write</code>: set for a few seconds after you post or change something, so
          you see your own change straight away.
        </li>
      </ul>
      <h2>Backups</h2>
      <p>No backups of the database are currently being made.</p>
      <h2>Deleting your account</h2>
      <p>
        <a href="/settings">Settings</a> has "Delete my account", which asks for your password. It
        deletes at once, in one go, everything above that belongs to the account: your profile,
        avatar and location, the text of your blurts and their embeddings, your reblurts, who you
        follow and who follows you, your likes (and the likes on your blurts), your invite codes,
        your reports, your sessions and your waitlist entry. You're logged out everywhere.
      </p>
      <p>
        What stays: an empty record of the account, with no username, password or profile, and an
        empty row for each of your blurts, with no text, which shows nowhere and names nobody. A
        blurt someone replied to shows as an empty placeholder, with no text and no author, so the
        thread still reads. The invite code you signed up with stays marked as used, with nothing
        linking it to you. Your username goes on the list of retired names, with nothing else, so
        nobody can sign up as you later. The count of sign-ups so far doesn't go down. Backups still
        hold the account until they expire, 30 days at most.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask what is stored about you, and have it corrected or deleted:
        <${PrivateContact} contact=${contact} />.
      </p>
    <//>
  `
}

// The search box is the page here, so the header leaves its own out.
function SearchPage({ viewer, query, users, blurts, next }: SearchData) {
  return html`
    <${Page}
      title="Search"
      tagline="Find people and blurts."
      search=${false}
      aside=${html`
        <${LinkPanel}
          title="Browse instead"
          links=${[
            ['/everyone', 'Everyone'],
            ...(viewer ? ([['/near', 'Near you']] as [string, string][]) : []),
          ]}
        />
        <${SupportLinks} />
      `}
    >
      <section class="panel composer">
        <h2>Search people and blurts</h2>
        <form method="get" action="/search" role="search" class="search-form">
          <label for="site-search-q" class="visually-hidden">Search</label>
          <input
            id="site-search-q"
            type="search"
            name="q"
            value=${query}
            maxlength=${searchQueryMaxLength}
            placeholder="Usernames and blurts"
          />
          <div class="row">
            <span class="tiny">Usernames by name, blurts by every word.</span>
            <${SubmitButton} icon="search" label="Search" />
          </div>
        </form>
      </section>
      ${
        query === ''
          ? html`<section class="panel">
              <p class="empty">Type a username or some words in the search box above.</p>
            </section>`
          : html`
              <p class="results-for">Results for <q>${query}</q></p>
              ${
                users.length > 0 &&
                html`<section aria-label="People" class="panel">
                  <h2>People</h2>
                  <ul class="user-matches">
                    ${users.map(
                      (user) =>
                        html`<li>
                          <a href="/${user.username}/"
                            ><${AvatarSvg} avatar=${user.avatar} /> ${user.username}</a
                          >
                        </li>`,
                    )}
                  </ul>
                </section>`
              }
              <section aria-label="Blurts" class="panel">
                <h2>Blurts</h2>
                ${
                  blurts.length > 0
                    ? blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)
                    : html`<p class="empty">No blurts match.</p>`
                }
                ${
                  next &&
                  html`<${NextPageLink} href=${searchUrl(query, next)} label="Older blurts" />`
                }
              </section>
            `
      }
    <//>
  `
}

// The share card image of a profile (none without a bio) and of a blurt (none when deleted).
function profileCardPath(profile: UserProfile): string | undefined {
  const text = profileCardText(profile.bio)
  return text
    ? ogProfileImagePath(
        profile.username,
        ogHash({
          text,
          username: profile.username,
          avatar: profile.avatar,
          color: profile.cardColor,
        }),
      )
    : undefined
}

function blurtCardPath(blurt: Blurt, cardColor: CardColorId | null): string | undefined {
  return blurt.deleted || blurt.username === null || blurt.text === null
    ? undefined
    : ogImagePath(
        blurt.id,
        ogHash(
          blurtOgInput(
            { text: blurt.text, username: blurt.username, avatar: blurt.avatar },
            cardColor,
          ),
        ),
      )
}

const metaDescriptionMax = 160
const shareTitleMax = 70

function profilePageMeta({ profile }: ProfilePageData): PageMeta {
  const description =
    profile.bio.trim() === ''
      ? `${profile.username} on blurt.trade`
      : preview(profile.bio, metaDescriptionMax)
  const image = profileCardPath(profile)
  return {
    title: profile.username,
    description,
    canonical: `/${profile.username}/`,
    author: profile.username,
    share: {
      type: 'profile',
      title: preview(`${profile.username} on blurt.trade`, shareTitleMax),
      description,
      image,
      imageAlt: image && `${profile.username}: ${profileCardText(profile.bio)}`,
    },
  }
}

function blurtPageMeta({ blurt, cardColor = null }: BlurtPageData): PageMeta {
  const canonical = blurtUrl(blurt)
  const deleted = blurt.deleted || blurt.username === null
  const description = deleted ? 'This blurt was deleted.' : blurt.text!
  const username = blurt.username ?? 'deleted'
  const title = deleted ? 'Deleted blurt' : `${username} blurted`
  const image = deleted
    ? undefined
    : ogImagePath(
        blurt.id,
        ogHash(blurtOgInput({ text: blurt.text!, username, avatar: blurt.avatar }, cardColor)),
      )
  return {
    title,
    description,
    canonical,
    author: deleted ? undefined : username,
    share: deleted
      ? { type: 'article', title, description }
      : {
          type: 'article',
          title,
          description,
          image,
          imageAlt: `${username}: ${description}`,
          publishedTime: blurt.createdAt.toISOString(),
          themeColor: blurt.text === 'BLURT' ? '#d4001c' : '#11152c',
        },
  }
}

function searchCanonical(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`
}

function nearCanonical(radius: number): string {
  return `/near?radius=${radius}`
}

function feedMeta(data: FeedData): PageMeta {
  const path = feedPath(data)
  return {
    title: data.feed === 'following' ? 'Following' : undefined,
    canonical: path,
  }
}

export function renderAboutPage(data: InfoPageData): string {
  return renderDocument(h(AboutPage, data), { title: 'About' })
}

export function renderTermsPage(data: InfoPageData): string {
  return renderDocument(h(TermsPage, data), { title: 'Terms' })
}

export function renderPrivacyPage(data: InfoPageData): string {
  return renderDocument(h(PrivacyPage, data), { title: 'Privacy' })
}

export function renderFeedPage(data: FeedData, composer?: ComposerProps): string {
  return renderDocument(h(FeedPage, { ...data, composer }), feedMeta(data))
}

export function renderLoginPage(props: LoginProps = {}): string {
  return renderDocument(h(LoginPage, props), { title: 'Log in', noindex: true })
}

export function renderCreateUserPage(props: CreateUserProps): string {
  return renderDocument(h(CreateUserPage, props), { title: 'Create a profile', noindex: true })
}

export function renderWaitlistPage(data: WaitlistData, form?: FormProps): string {
  return renderDocument(h(WaitlistPage, { ...data, form }), { title: 'Waitlist', noindex: true })
}

export function renderBlurtPage(
  data: BlurtPageData,
  composer?: ComposerProps,
  reportError?: string,
): string {
  return renderDocument(h(BlurtPage, { ...data, composer, reportError }), blurtPageMeta(data))
}

export function renderAdminToolsPage(data: AdminToolsData): string {
  return renderDocument(h(AdminToolsPage, data), { title: 'Admin', noindex: true })
}

export function renderAdminReportsPage(data: AdminReportsData): string {
  return renderDocument(h(AdminReportsPage, data), { title: 'Reports', noindex: true })
}

export function renderProfilePage(data: ProfilePageData): string {
  return renderDocument(h(ProfilePage, data), profilePageMeta(data))
}

export function renderSettingsPage(data: SettingsData): string {
  return renderDocument(h(SettingsPage, data), { title: 'Settings', noindex: true })
}

export function renderDeleteAccountPage(data: DeleteAccountData, validationError?: string): string {
  return renderDocument(h(DeleteAccountPage, { ...data, validationError }), {
    title: 'Delete account',
    noindex: true,
  })
}

export function renderSearchPage(data: SearchData): string {
  const title = data.query === '' ? 'Search' : preview(data.query, shareTitleMax)
  const description =
    data.query === ''
      ? 'Search usernames and blurts.'
      : `Search results for “${preview(data.query, 80)}”.`
  return renderDocument(h(SearchPage, data), {
    title,
    description,
    canonical: searchCanonical(data.query),
    noindex: true,
  })
}

export function renderNearPage(data: NearData): string {
  return renderDocument(h(NearPage, data), {
    title: 'Blurts near you',
    description: siteDescription,
    canonical: nearCanonical(data.radius),
    noindex: true,
  })
}

export function renderProfileEditPage(props: ProfileEditProps): string {
  return renderDocument(h(ProfileEditForm, props), {
    title: `Edit profile: ${props.profile.username}`,
  })
}
