import { h } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import { gridDegrees, mapHeight, mapUrl, mapWidth, pointToPixel, type GeoPoint } from '../geo.ts'
import type { AuthenticatedUser } from '../middleware/auth.ts'
import type { Contact } from '../config.ts'
import { avatarLabels, eyeTypes, hairTypes, toothTypes, type Avatar } from '../avatar.ts'
import { AvatarSvg } from './avatar.ts'
import { stylesheetUrl } from './styles.ts'
import {
  bioMaxLength,
  blurtMaxLength,
  isWebUrl,
  linkMaxLength,
  passwordMaxLength,
  passwordMinLength,
  reportReasonMaxLength,
  usernameMaxLength,
} from '../limits.ts'
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
      <label
        >${label} <textarea name="text" maxlength=${blurtMaxLength} required>${text}</textarea>
      </label>
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
      <label
        >Username <input name="username" maxlength=${usernameMaxLength} required value=${username}
      /></label>
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

// Said at sign-up, in the terms and on the privacy page: no email means no reset.
export const noPasswordReset =
  "Keep your password safe, e.g. in a password manager. We don't take an email address, " +
  "so there's no password reset: a lost password can't be recovered, and neither can the " +
  'account.'

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
          minlength=${passwordMinLength}
          maxlength=${passwordMaxLength}
          required
      /></label>
      <p class="hint">${noPasswordReset}</p>
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
      <label
        >Username <input name="username" maxlength=${usernameMaxLength} required value=${username}
      /></label>
      <label
        >Password <input name="password" type="password" maxlength=${passwordMaxLength} required
      /></label>
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
        <label>Reason (optional) <input name="reason" maxlength=${reportReasonMaxLength} /></label>
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
            maxlength=${linkMaxLength}
            value=${profile.homepage}
            placeholder="https://example.com"
          />
        </label>
        <label
          >X
          <input
            name="x"
            maxlength=${linkMaxLength}
            value=${profile.x}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >Instagram
          <input
            name="instagram"
            maxlength=${linkMaxLength}
            value=${profile.instagram}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >TikTok
          <input
            name="tiktok"
            maxlength=${linkMaxLength}
            value=${profile.tiktok}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >YouTube
          <input
            name="youtube"
            maxlength=${linkMaxLength}
            value=${profile.youtube}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >GitHub
          <input
            name="github"
            maxlength=${linkMaxLength}
            value=${profile.github}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >LinkedIn
          <input
            name="linkedin"
            maxlength=${linkMaxLength}
            value=${profile.linkedin}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >Bio
          <textarea name="bio" maxlength=${bioMaxLength} placeholder="Say the thing.">
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

// How to reach the owner privately, or a note that no address is set up.
function PrivateContact({ contact }: { contact: Contact }) {
  return contact.email
    ? html`email <a href=${`mailto:${contact.email}`}>${contact.email}</a>`
    : html`the contact on the <a href="/about">About page</a>`
}

function InfoHeader({ title }: { title: string }) {
  return html`
    <header>
      <h1>${title}</h1>
      <p><a href="/">Back to blurt.trade</a></p>
    </header>
  `
}

function AboutPage({ contact }: InfoPageData) {
  const { email, issuesUrl, securityUrl } = contact
  return html`
    <${InfoHeader} title="About blurt.trade" />
    <main>
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
    </main>
  `
}

function TermsPage({ contact }: InfoPageData) {
  return html`
    <${InfoHeader} title="Terms" />
    <main>
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
    </main>
  `
}

function PrivacyPage({ contact }: InfoPageData) {
  return html`
    <${InfoHeader} title="Privacy" />
    <main>
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
          The profile fields you fill in: bio, homepage and social links, and your avatar's
          settings.
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
        <li>Who you follow.</li>
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
        Public: your username, profile, avatar, blurts, follower counts and who invited you.
        Everything else is private, though admins see who reported what.
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
        <li><code>access_token</code>: shows you're logged in. Lasts 5 minutes.</li>
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
      <p>
        The database is backed up every night, encrypted, to a storage provider. Backups are kept
        for 30 days, so anything deleted is gone from them within 30 days.
      </p>
      <h2>Deleting your account</h2>
      <p>
        Deleting your account deletes everything above that belongs to it. A blurt someone replied
        to stays as an empty placeholder, with no text and no author, so the thread still reads.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask what is stored about you, and have it corrected or deleted:
        <${PrivateContact} contact=${contact} />.
      </p>
    </main>
  `
}

function Footer() {
  return html`
    <footer>
      <nav aria-label="About this site">
        <a href="/about">About</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
      </nav>
    </footer>
  `
}

function IndexDocument({ children }: { children: unknown }) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>blurt.trade</title>
        <link rel="stylesheet" href=${stylesheetUrl} />
      </head>
      <body>
        ${children}
        <${Footer} />
      </body>
    </html>`
}

export function renderAboutPage(data: InfoPageData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(AboutPage, data) }))
}

export function renderTermsPage(data: InfoPageData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(TermsPage, data) }))
}

export function renderPrivacyPage(data: InfoPageData): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(PrivacyPage, data) }))
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
