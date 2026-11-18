import { cardColors } from '../../card-colors.ts'
import { profileCardPath } from '../profile/profile.html.ts'
import { ButtonLink, LocationMap } from '../shared/components.ts'
import type { NotificationSettings } from '../../routes/state/notifications.ts'
import type { PushSettings } from './data.ts'
import { plural } from '../../ui/text.ts'
import type { UserProfile } from '../../routes/state/profiles.ts'
import type { GeoPoint } from '../../shared/geo.ts'
import { blurtMaxLength } from '../../shared/limits.ts'
import { themes } from '../../shared/themes.ts'
import { localeLabel, locales, timeZones } from '../../shared/time-zones.ts'
import { usePageContext } from '../../ui/context.ts'
import { PushDeviceButton } from '../../ui/push.ts'
import { SubmitButton, ValidationError } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { Icon } from '../../ui/icons.ts'
import { LocationStatus } from '../../ui/location.ts'

// The forms on the edit page below the profile form: location, theme, time zone,
// notifications and share card colour (the avatar's and the picture's are in src/ui). Each is a plain POST that works without
// JavaScript.

export function LocationForms({ location, error }: { location: GeoPoint | null; error?: string }) {
  return html`
    <section class="panel" aria-label="Location, time zone and language" id="location">
      <h2>Location, time zone and language</h2>
      <p>
        Optional. Set it to see <a href="/near">blurts near you</a>. Setting it also sets your time
        zone to that place's.
      </p>
      <${ValidationError} message=${error} />
      <${LocationStatus} location=${location} />
      <${LocationMap} location=${location} />
      ${
        // Always there, hidden while nothing is stored, so the map's script can show it
        // after a click without a page load.
        html`<form
          method="post"
          action="/api/location"
          class="inline location-clear"
          hidden=${!location}
        >
          <input type="hidden" name="clear" value="1" />
          <${SubmitButton} icon="trash" label="Remove my location" kind="secondary" />
        </form>`
      }
      <${TimeZoneForm} />
    </section>
  `
}

// The colour theme, saved on the account and carried in the access token (see src/themes.ts). Each choice shows a
// strip of its colours (classes in public/style.css), so no JS is needed to preview.
export function ThemeForm() {
  const current = usePageContext().theme
  return html`
    <section class="panel" aria-label="Theme" id="theme">
      <h2>Theme</h2>
      <p class="tiny">Saved on your account, so it follows you to every device.</p>
      <form method="post" action="/api/theme" data-enhance="autosave">
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
  const { timeZone: current, pickedLocale: locale } = usePageContext()
  return html`
    <div id="timezone">
      <p class="tiny">
        Times are shown in UTC until you pick your time zone. The language decides how dates and
        times are written (17.10.2026 14:37 or 10/17/2026 02:37 PM); until you pick one, your
        browser's language is used. Saved on your account, so it follows you to every device.
      </p>
      <form method="post" action="/api/timezone" data-enhance="autosave">
        <div class="field-grid">
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
        </div>
        <div class="actions"><${SubmitButton} icon="save" label="Save time settings" /></div>
      </form>
    </div>
  `
}

// One checkbox per kind of notification, saved with a plain POST. An unticked box sends
// nothing, so what is left out is off.
export function NotificationsForm({
  settings,
  push,
}: {
  settings: NotificationSettings
  push?: PushSettings
}) {
  return html`
    <section class="panel" aria-label="Notifications" id="notifications">
      <h2>Notifications</h2>
      <p class="tiny">
        Choose what ends up on your notifications page and in the count in Your corner. Only new
        things after you switch a kind on are added. Nobody is notified about their own actions.
      </p>
      <form method="post" action="/api/notifications/settings" data-enhance="autosave">
        <label class="check"
          ><input type="checkbox" name="replies" value="1" checked=${settings.replies} /> Replies to
          my blurts</label
        >
        <label class="check"
          ><input type="checkbox" name="reblurts" value="1" checked=${settings.reblurts} /> Reblurts
          and quotes of my blurts (a quote is a reblurt with a comment, so it counts here, and is
          listed as "quoted")</label
        >
        <label class="check"
          ><input
            type="checkbox"
            name="followedBlurts"
            value="1"
            checked=${settings.followedBlurts}
          />
          New blurts from people I follow (can get noisy)</label
        >
        <div class="actions">
          <${SubmitButton} icon="save" label="Save notification settings" />
        </div>
      </form>
      ${push && html`<${PushForms} push=${push} />`}
    </section>
  `
}

// Push notifications on this device (src/ui/push.ts) and, while any device gets them, a
// plain form that stops them everywhere, which works without JavaScript too.
function PushForms({ push }: { push: PushSettings }) {
  return html`
    <h2>On your devices</h2>
    <${PushDeviceButton} push=${push} />
    ${
      push.devices > 0 &&
      html`<form method="post" action="/api/push/subscriptions/delete" class="push-all">
        <p class="tiny">
          Push notifications are on for ${plural(push.devices, 'device', 'devices')}. They also stop
          when you log out there.
        </p>
        <div class="actions">
          <${SubmitButton}
            icon="bell"
            label="Stop push notifications on all devices"
            kind="secondary"
          />
        </div>
      </form>`
    }
  `
}

// The colour of the share cards. Its inputs and button belong to the profile form
// (profile-edit.html.ts, via the `form` attribute), so one POST saves everything and no
// JavaScript is needed.
//
// The settings forms on this page are `data-enhance="autosave"`: with JavaScript they save
// as they change and their save buttons give way to a status line (src/client/autosave.ts).
// Without it, the buttons below are how they save.
export function CardForm({ profile }: { profile: UserProfile }) {
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
