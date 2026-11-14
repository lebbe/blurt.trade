import type { ComponentChildren } from 'preact'
import { contact, publicUrl } from '../../config.ts'
import { type GeoPoint, mapHeight, mapUrl, mapWidth } from '../../shared/geo.ts'
import { usePageContext } from '../../ui/context.ts'
import { SubmitButton } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { Icon, type IconName } from '../../ui/icons.ts'
import type { ListKind } from '../../ui/lists.ts'
import { MapMarker } from '../../ui/location.ts'

// Small components more than one page uses. One that only a single page uses stays in
// that page's folder; the ones the browser renders too are in src/ui/.

export type FormProps = {
  username?: string
  validationError?: string
}

// A link that looks like a button, with an icon. `kind` '' is the main (filled) style.
export function ButtonLink({
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

// For the asides: a panel with a heading and a list of links.
export function LinkPanel({
  title,
  links,
}: {
  title: string
  links: [href: string, label: ComponentChildren][]
}) {
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
// `suggestions` (the front page) adds a link to the GitHub issues, when CONTACT_REPO_URL
// is set.
export function SupportLinks({ suggestions = false }: { suggestions?: boolean }) {
  const { issuesUrl } = contact()
  return html`<${LinkPanel}
    title="About this site"
    links=${[
      ['/about', 'About and contact'],
      ...(suggestions && issuesUrl ? [[issuesUrl, 'Submit suggestions'] as [string, string]] : []),
      ['/terms', 'Terms'],
      ['/privacy', 'Privacy'],
    ]}
  />`
}

// Where a composer would be, for anonymous visitors.
export function AnonymousActions({ heading = 'Blurt now' }: { heading?: string }) {
  return html`
    <section class="panel composer">
      <h2>${heading}</h2>
      <p>Make a profile to blurt. It takes a username and a password, nothing else.</p>
      <div class="actions">
        <${ButtonLink} href="/signup" icon="personPlus" label="Create a profile" kind="" />
        <${ButtonLink} href="/login" icon="login" label="Log in" />
      </div>
    </section>
  `
}

// "Use JavaScript" (src/javascript.ts): what it does, whether it's on, and a plain form
// button that flips it, which works with JavaScript off. On /settings for logged-in users
// (saved on the account) and on /about for everyone else (a cookie in this browser).
export function JavaScriptSetting() {
  const { viewer, javascript } = usePageContext()
  const where = viewer ? 'for your account, on every device' : 'in this browser'
  return html`
    <p>
      Everything works without JavaScript: every page is plain HTML and every button is an ordinary
      form. A little JavaScript, only from blurt.trade itself, can make some things smoother. It is
      optional: turned off, not a single script is sent.
    </p>
    <p>JavaScript is <strong>${javascript ? 'on' : 'off'}</strong> ${where}.</p>
    <form method="post" action="/api/javascript" class="inline">
      <input type="hidden" name="javascript" value=${javascript ? 'off' : 'on'} />
      <${SubmitButton}
        icon="sliders"
        label=${`Turn JavaScript ${javascript ? 'off' : 'on'}`}
        kind="secondary"
      />
    </form>
  `
}

// The link to the next page of a list. With `list` (which kind it is, src/ui/lists.ts) and
// JavaScript on, src/client/more.ts loads that page into this one as it scrolls into view;
// the link stays as it was for everyone else.
export function NextPageLink({
  href,
  label,
  list,
}: {
  href: string
  label: string
  list?: ListKind
}) {
  return html`<p class="next-page" data-enhance=${list && 'more'} data-list=${list}>
    <a href=${href} rel="next">${label}</a>
  </p>`
}

// Opt-in, coarse location. Clicking the map image submits the pixel (location.x,
// location.y) with no JS; the server snaps it to a grid cell. The marker shows exactly what
// is stored.
//
// With JavaScript, src/client/map.ts saves the click with fetch() instead, moves the marker
// in place, and lets the arrow keys move it (Enter or Space saves).
export function LocationMap({
  location,
  returnTo,
}: {
  location: GeoPoint | null
  returnTo?: 'near'
}) {
  return html`
    <form method="post" action="/api/location" class="map-form" data-enhance="map">
      ${returnTo && html`<input type="hidden" name="return" value=${returnTo} />`}
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
          ${location && html`<${MapMarker} location=${location} />`}
        </div>
      </div>
    </form>
  `
}

// What the profile's owner sees while sign-up doesn't need an invite code: share the
// sign-up page itself.
export function InviteFriends() {
  const url = `${publicUrl()}/signup`
  return html`
    <section class="panel" aria-label="Invite your friends">
      <h3>Invite your friends</h3>
      <p>blurt.trade is better filled with people you know. Share this link:</p>
      <p><a href=${url}>${url}</a></p>
    </section>
  `
}
