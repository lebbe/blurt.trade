import { h } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import { gridDegrees, mapHeight, mapUrl, mapWidth, pointToPixel, type GeoPoint } from '../geo.ts'
import type { AuthenticatedUser } from '../middleware/auth.ts'
import { avatarLabels, eyeTypes, hairTypes, toothTypes, type Avatar } from '../avatar.ts'
import { AvatarSvg, avatarCss } from './avatar.ts'
import type {
  Blurt,
  FeedItem,
  FollowStats,
  InviteCode,
  ReportedBlurt,
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

// /admin/reports: blurts with open reports, the one waiting longest first.
export type AdminReportsData = { viewer: AuthenticatedUser; reports: ReportedBlurt[] }

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

type ProfileEditProps = ProfileEditData & {
  validationError?: string
  locationError?: string
  avatarError?: string
}

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
      <a href="/near">Near you</a>
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

// A deleted placeholder has no author, so it lives at /deleted/:id ('deleted' is a
// reserved username). Its page also answers under the old author's name.
export function blurtUrl(blurt: Blurt): string {
  return `/${blurt.username ?? 'deleted'}/${blurt.id}`
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

// Two clicks, no JS: the <details> opens the form, its button deletes for good.
function DeleteForm({ blurt }: { blurt: Blurt }) {
  return html`
    <details class="blurt-action">
      <summary>Delete</summary>
      <form method="post" action=${deleteBlurtPath(blurt)} class="inline-form">
        <span>Delete this blurt for good?</span>
        <button type="submit">Delete</button>
      </form>
    </details>
  `
}

function ReportForm({ blurt, error }: { blurt: Blurt; error?: string }) {
  return html`
    <details class="blurt-action" open=${Boolean(error)}>
      <summary>Report</summary>
      <form method="post" action="/api/report" class="inline-form">
        <${ValidationError} message=${error} />
        <input type="hidden" name="blurtId" value=${blurt.id} />
        <label>Reason (optional) <input name="reason" maxlength="500" /></label>
        <button type="submit">Report</button>
      </form>
    </details>
  `
}

// `replies` are shown inline (the feed); the link below covers the rest of the thread.
// `viewer` decides the Delete / Report actions; `reported` says the viewer already did.
function BlurtCard({
  blurt,
  viewer = null,
  replies = [],
  showActions = true,
  reported = false,
  reportError,
}: {
  blurt: Blurt
  viewer?: Viewer
  replies?: Blurt[]
  showActions?: boolean
  reported?: boolean
  reportError?: string
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
  const action = blurtActions(viewer, blurt)
  const replyCards =
    replies.length > 0 &&
    html`<div class="replies">
      ${replies.map((reply) => html`<${BlurtCard} blurt=${reply} viewer=${viewer} />`)}
    </div>`

  if (blurt.deleted) {
    return html`
      <article class="blurt deleted">
        <div class="blurt-body">
          <div class="blurt-meta">
            <em>Deleted</em>
            <a href=${blurtUrl(blurt)}
              ><time datetime=${blurt.createdAt.toISOString()}
                >${blurt.createdAt.toLocaleString()}</time
              ></a
            >
          </div>
          <p class="empty">This blurt was deleted.</p>
          ${replyCards}
          ${
            showActions &&
            html`<p class="blurt-actions"><a href=${blurtUrl(blurt)}>${threadLink}</a></p>`
          }
        </div>
      </article>
    `
  }

  // The avatar sits on the left of odd blurts and the right of even ones (CSS).
  return html`
    <article class="blurt">
      <${AvatarSvg} avatar=${blurt.avatar} />
      <div class="blurt-body">
        <div class="blurt-meta">
          <strong><a href="/${blurt.username}/">${blurt.username}</a></strong>
          <a href=${blurtUrl(blurt)}
            ><time datetime=${blurt.createdAt.toISOString()}
              >${blurt.createdAt.toLocaleString()}</time
            ></a
          >
        </div>
        <p>${blurt.text}</p>
        ${replyCards}
        <div class="blurt-actions">
          ${showActions && html`<a href=${blurtUrl(blurt)}>${threadLink}</a>`}
          ${action === 'delete' && html`<${DeleteForm} blurt=${blurt} />`}
          ${
            action === 'report' &&
            (reported
              ? html`<span class="empty">You reported this blurt.</span>`
              : html`<${ReportForm} blurt=${blurt} error=${reportError} />`)
          }
        </div>
      </div>
    </article>
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
}: BlurtPageProps) {
  return html`
    <header>
      <h1>${blurt.username ?? 'Deleted blurt'}</h1>
      <p class="tagline"><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      ${
        parent &&
        html`<section aria-label="In reply to">
          <h2>In reply to</h2>
          <${BlurtCard} blurt=${parent} viewer=${viewer} />
        </section>`
      }
      <${BlurtCard}
        blurt=${blurt}
        viewer=${viewer}
        showActions=${false}
        reported=${reported}
        reportError=${reportError}
      />
      <section aria-label="Replies">
        <h2>Replies</h2>
        ${
          blurt.deleted
            ? null
            : viewer
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
            ? replies.map((reply) => html`<${BlurtCard} blurt=${reply} viewer=${viewer} />`)
            : html`<p class="empty">No replies yet.</p>`
        }
        ${next && html`<${NextPageLink} href=${moreRepliesUrl(blurt, next)} label="More replies" />`}
      </section>
      <section aria-label="Related blurts">
        <h2>Related blurts</h2>
        ${
          related.length > 0
            ? related.map((other) => html`<${BlurtCard} blurt=${other} viewer=${viewer} />`)
            : html`<p class="empty">Nothing related yet.</p>`
        }
      </section>
    </main>
  `
}

// Moderation: blurts with open reports, each with Delete and Dismiss buttons.
function AdminReportsPage({ reports }: AdminReportsData) {
  return html`
    <header>
      <h1>Reports</h1>
      <p class="tagline"><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      ${
        reports.length > 0
          ? reports.map(
              ({ blurt, reports: open }) => html`
                <section class="report" aria-label="Reported blurt ${blurt.id}">
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
                  <div class="report-buttons">
                    <form method="post" action=${deleteBlurtPath(blurt)} class="inline-form">
                      <button type="submit">Delete blurt</button>
                    </form>
                    <form method="post" action="/api/admin/reports/dismiss" class="inline-form">
                      <input type="hidden" name="blurtId" value=${blurt.id} />
                      <button type="submit">Dismiss</button>
                    </form>
                  </div>
                </section>
              `,
            )
          : html`<p class="empty">No open reports.</p>`
      }
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

// Opt-in, coarse location. Clicking the map image submits the pixel (location.x,
// location.y) with no JS; the server snaps it to a grid cell. The number fields are the
// fallback for keyboards, which can't click a spot. The marker shows exactly what is stored.
function LocationForms({ location, error }: { location: GeoPoint | null; error?: string }) {
  const marker = location && pointToPixel(location)
  return html`
    <section aria-label="Location">
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
          <div class="map-inner" style=${{ width: `${mapWidth}px`, height: `${mapHeight}px` }}>
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
              html`<span
                class="map-marker"
                aria-hidden="true"
                style=${{ left: `${marker.x}px`, top: `${marker.y}px` }}
              ></span>`
            }
          </div>
        </div>
      </form>
      <form method="post" action="/api/location">
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
        <button type="submit">Set location</button>
      </form>
      ${
        location &&
        html`<form method="post" action="/api/location">
          <input type="hidden" name="clear" value="1" />
          <button type="submit">Remove my location</button>
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
    <section aria-label="Avatar">
      <h2>Avatar</h2>
      <${ValidationError} message=${error} />
      <form method="post" action="/api/avatar" class="avatar-form">
        <div class="avatar-preview">
          <${AvatarSvg} avatar=${avatar} label="Your avatar" size="large" />
          <p class="empty">Hover it to hear it talk.</p>
        </div>
        <div class="avatar-fields">
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
        <div class="avatar-buttons">
          <button type="submit">Save avatar</button>
          <button type="submit" name="random" value="1" formnovalidate>Random</button>
        </div>
      </form>
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
      <${AvatarForm} avatar=${profile.avatar} error=${avatarError} />
      <${LocationForms} location=${location} error=${locationError} />
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

function NearPage({ viewer, location, radius, radii, blurts, next }: NearData) {
  return html`
    <header>
      <h1>Blurts near you</h1>
      <p class="tagline"><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      ${
        location
          ? html`
              <p>
                From people within ${radius} km of ${formatLocation(location)}.${' '}
                <a href="/${viewer.username}/edit">Change your location</a>
              </p>
              <form method="get" action="/near" class="radius-form">
                <label
                  >Radius
                  <select name="radius">
                    ${radii.map(
                      (km) => html`<option value=${km} selected=${km === radius}>${km} km</option>`,
                    )}
                  </select>
                </label>
                <button type="submit">Show</button>
              </form>
              <section aria-label="Blurts">
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
          : html`<p>
              You haven't set a location.${' '}
              <a href="/${viewer.username}/edit">Click the map on your edit page</a> to see blurts
              from people near you.
            </p>`
      }
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
  const feed = blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)

  return html`
    <header class="profile-header">
      <${AvatarSvg} avatar=${profile.avatar} label="${profile.username}'s avatar" size="large" />
      <div>
        <h1>${profile.username}</h1>
        <p class="tagline"><a href="/">Back to blurt.trade</a></p>
      </div>
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
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            margin-top: 0.75rem;
          }
          .blurt:nth-of-type(even) {
            flex-direction: row-reverse;
          }
          .blurt-body {
            flex: 1;
            min-width: 0;
          }
          .profile-header {
            display: flex;
            align-items: center;
            gap: 1rem;
          }
          .avatar-form {
            grid-template-columns: auto 1fr;
            align-items: start;
            gap: 1rem;
          }
          .avatar-preview p {
            margin: 0.25rem 0 0;
            font-size: 0.85rem;
          }
          .avatar-fields {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
            gap: 0.75rem;
          }
          .avatar-buttons {
            grid-column: 1 / -1;
            display: flex;
            gap: 0.75rem;
          }
          .color-field input {
            width: 100%;
            height: 2.6rem;
            padding: 0.2rem;
          }
          select {
            font: inherit;
            padding: 0.6rem;
            border: 1px solid #aaa095;
            background: #fffdf8;
          }
          ${avatarCss} .blurt-meta {
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
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 1rem;
            margin: 0.5rem 0 0;
            font-size: 0.85rem;
          }
          .blurt-action summary {
            cursor: pointer;
            color: #6d6258;
          }
          .inline-form {
            display: flex;
            flex-wrap: wrap;
            align-items: end;
            gap: 0.5rem;
            margin: 0.5rem 0 0;
            padding: 0.5rem;
          }
          .inline-form button,
          .inline-form input {
            padding: 0.3rem 0.6rem;
          }
          .blurt.deleted {
            border-style: dashed;
          }
          .report ul {
            margin: 0.5rem 0;
          }
          .report-buttons {
            display: flex;
            gap: 0.75rem;
          }
          .report-buttons .inline-form {
            border: 0;
            background: none;
            padding: 0;
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
          .map {
            overflow-x: auto;
            margin-bottom: 1rem;
          }
          .map-form {
            padding: 0;
          }
          .map-inner {
            position: relative;
          }
          .map-inner input {
            display: block;
            padding: 0;
            border: 0;
            cursor: crosshair;
          }
          .map-marker {
            position: absolute;
            width: 10px;
            height: 10px;
            margin: -7px 0 0 -7px;
            border: 2px solid #fffdf8;
            border-radius: 50%;
            background: #a32020;
            pointer-events: none;
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

export function renderBlurtPage(
  data: BlurtPageData,
  composer?: ComposerProps,
  reportError?: string,
): string {
  return (
    '<!doctype html>' +
    renderToString(h(IndexDocument, { children: h(BlurtPage, { ...data, composer, reportError }) }))
  )
}

export function renderAdminReportsPage(data: AdminReportsData): string {
  return (
    '<!doctype html>' + renderToString(h(IndexDocument, { children: h(AdminReportsPage, data) }))
  )
}

export function renderProfilePage(data: ProfilePageData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(ProfilePage, data) }))
}

export function renderSettingsPage(data: SettingsData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(SettingsPage, data) }))
}

export function renderNearPage(data: NearData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(NearPage, data) }))
}

export function renderProfileEditPage(props: ProfileEditProps): string {
  return (
    '<!doctype html>' + renderToString(h(IndexDocument, { children: h(ProfileEditForm, props) }))
  )
}
