import { cardColors } from '../../card-colors.ts'
import { profileCardPath } from '../profile/profile.html.ts'
import { ButtonLink, LocationMap } from '../shared/components.ts'
import type { NotificationSettings } from '../../routes/state/notifications.ts'
import type { UserProfile } from '../../routes/state/profiles.ts'
import {
  type Avatar,
  avatarLabels,
  cutImageSize,
  eyeTypes,
  hairTypes,
  headWidths,
  photoUrl,
  toothTypes,
} from '../../shared/avatar.ts'
import type { GeoPoint } from '../../shared/geo.ts'
import { blurtMaxLength } from '../../shared/limits.ts'
import { themes } from '../../shared/themes.ts'
import { localeLabel, locales, timeZones } from '../../shared/time-zones.ts'
import { AvatarSvg, AvatarView, cutHint } from '../../ui/avatar.ts'
import { usePageContext } from '../../ui/context.ts'
import { SubmitButton, ValidationError } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { Icon } from '../../ui/icons.ts'
import { LocationStatus } from '../../ui/location.ts'

// The forms on the edit page below the profile form: location, avatar, picture, theme,
// time zone, notifications and share card colour. Each is a plain POST that works without
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

function TypeSelect<T extends keyof typeof avatarLabels>({
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
export function AvatarForm({ avatar, error }: { avatar: Avatar; error?: string }) {
  return html`
    <section class="panel" aria-label="Avatar" id="avatar">
      <h2>Avatar</h2>
      <${ValidationError} message=${error} />
      <form method="post" action="/api/avatar" class="avatar-form" data-enhance="autosave">
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

// The profile picture: upload one (redrawn on the server like a blurt's picture, cropped
// square), set where it opens its mouth by clicking the picture (cut.x/cut.y, no JS, like
// the location map; the dashed line is the stored cut, drawn into the image), or remove
// it. While there is one it is shown instead of the cartoon above.
export function ProfilePictureForm({ avatar, error }: { avatar: Avatar; error?: string }) {
  const photo = avatar.photo
  return html`
    <section class="panel" aria-label="Profile picture" id="picture">
      <h2>Profile picture</h2>
      <p>
        ${
          photo
            ? 'Shown instead of the cartoon avatar, also on your share cards. Remove it to get the cartoon back.'
            : "Optional. Instead of the cartoon, your own picture: we redraw it as a rough drawing, like a blurt's picture, and keep only that. It talks by flapping open where you click."
        }
      </p>
      <${ValidationError} message=${error} />
      ${
        photo &&
        html`<div class="picture-editor">
          <form
            method="post"
            action="/api/profile-picture/cut"
            class="cut-form"
            data-enhance="mouth"
          >
            <input
              type="image"
              name="cut"
              src=${photoUrl(photo, 'edit')}
              width=${cutImageSize}
              height=${cutImageSize}
              alt="Your profile picture: click where the mouth should open"
            />
            <p class="tiny cut-hint">${cutHint(photo.cut)}</p>
          </form>
          <div class="avatar-preview">
            <${AvatarView} avatar=${avatar} label="Your profile picture" size="large" />
            <p class="empty">Hover it to hear it talk.</p>
          </div>
        </div>`
      }
      <form
        method="post"
        action="/api/profile-picture"
        enctype="multipart/form-data"
        class="picture-upload"
      >
        <label
          >${photo ? 'New picture' : 'Picture'}
          <input
            type="file"
            name="picture"
            class="picture-field"
            accept="image/jpeg,image/png,image/webp"
            required
          />
        </label>
        <div class="actions">
          <${SubmitButton} icon="save" label="Upload picture" />
          ${
            photo &&
            html`<button type="submit" name="remove" value="1" class="secondary" formnovalidate>
              <${Icon} name="trash" /><span>Remove picture</span>
            </button>`
          }
        </div>
      </form>
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
export function NotificationsForm({ settings }: { settings: NotificationSettings }) {
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
    </section>
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
