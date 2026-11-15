import {
  type Avatar,
  avatarLabels,
  eyeTypes,
  hairTypes,
  headWidths,
  toothTypes,
} from '../shared/avatar.ts'
import { AvatarSvg } from './avatar.ts'
import { ValidationError } from './forms.ts'
import { html } from './html.ts'
import { Icon } from './icons.ts'

// The cartoon avatar's form on the edit page. In src/ui rather than with the edit page's
// other forms because the browser renders it too: removing the profile picture without a
// page load brings it back, as the page would show it (src/client/picture-upload.ts).

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
//
// `action`: where it posts (a bot's owners post to the bot's own, src/routes/bots.ts). A
// bot's avatar (`avatar.robot`) is a robot, drawn from the same fields under robot names.
export function AvatarForm({
  avatar,
  error,
  action = '/api/avatar',
  label = 'Your avatar',
}: {
  avatar: Avatar
  error?: string
  action?: string
  label?: string
}) {
  const robot = avatar.robot === true
  const name = (person: string, bot: string) => (robot ? bot : person)
  return html`
    <section class="panel" aria-label="Avatar" id="avatar">
      <h2>Avatar</h2>
      <${ValidationError} message=${error} />
      <form
        method="post"
        action=${action}
        class="avatar-form"
        data-enhance="autosave"
        data-robot=${robot ? 'true' : undefined}
      >
        <div class="avatar-preview">
          <${AvatarSvg} avatar=${avatar} label=${label} size="large" />
          <p class="empty">Hover it to hear it talk.</p>
        </div>
        <div class="avatar-fields">
          <${TypeSelect}
            name="headWidth"
            label=${name('Head', 'Body')}
            types=${headWidths}
            value=${avatar.headWidth ?? 'regular'}
          />
          <${ColorInput}
            name="skin"
            label=${name('Skin colour', 'Plating colour')}
            value=${avatar.skin}
          />
          <${TypeSelect}
            name="hairType"
            label=${name('Hair', 'Antenna')}
            types=${hairTypes}
            value=${avatar.hairType}
          />
          <${ColorInput}
            name="hairColor"
            label=${name('Hair colour', 'Antenna colour')}
            value=${avatar.hairColor}
          />
          <${TypeSelect}
            name="eyeType"
            label=${name('Eyes', 'Lenses')}
            types=${eyeTypes}
            value=${avatar.eyeType}
          />
          <${ColorInput}
            name="eyeColor"
            label=${name('Eye colour', 'Lens colour')}
            value=${avatar.eyeColor}
          />
          <${ColorInput}
            name="pupilColor"
            label=${name('Pupil colour', 'Glow colour')}
            value=${avatar.pupilColor}
          />
          <${TypeSelect}
            name="toothType"
            label=${name('Teeth', 'Grille')}
            types=${toothTypes}
            value=${avatar.toothType}
          />
          <${ColorInput}
            name="toothColor"
            label=${name('Tooth colour', 'Grille colour')}
            value=${avatar.toothColor}
          />
        </div>
        <div class="actions avatar-buttons">
          <button type="submit"><${Icon} name="save" /><span>Save avatar</span></button>
          <button type="submit" name="random" value="1" formnovalidate>Random</button>
        </div>
      </form>
    </section>
  `
}
