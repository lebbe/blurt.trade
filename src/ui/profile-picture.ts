import { type Avatar, cutImageSize, photoUrl } from '../shared/avatar.ts'
import { AvatarView, cutHint } from './avatar.ts'
import { SubmitButton, ValidationError } from './forms.ts'
import { html } from './html.ts'
import { Icon } from './icons.ts'

// The profile picture: upload one (redrawn on the server like a blurt's picture, cropped
// square), set where it opens its mouth by clicking the picture (cut.x/cut.y, no JS, like
// the location map; the dashed line is the stored cut, drawn into the image), or remove
// it. While there is one it is shown instead of the cartoon above.
//
// In src/ui rather than with the edit page's other forms because the browser renders it
// too: with JavaScript the upload is previewed, cropped and given its mouth before it is
// sent (src/client/picture-upload.ts), and the answer draws this panel again in place.
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
        data-enhance="picture-upload"
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
