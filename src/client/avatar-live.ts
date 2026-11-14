import { randomAvatarWith, type Avatar } from '../shared/avatar.ts'
import type { PageContext } from '../ui/context.ts'
import type { LiveForm } from './autosave.ts'
import { showOwnAvatars } from './avatar-preview.ts'

// The avatar form on the edit page, for autosave: the cartoon is drawn again from the
// fields as they change (while a colour is being dragged in the picker, a select stepped
// through with the arrow keys), before anything is saved, wherever the viewer's avatar is
// on the page. Saving goes on as before, on `change`. If it fails, the fields and the
// drawings go back to the avatar saved last, and autosave says why.
//
// "Random" is picked here too, from the same palettes as the server's (randomAvatarWith in
// src/shared/avatar.ts): the fields get the new values, the drawing follows at once, and the
// form is saved as if they had been picked by hand. Without JavaScript the button still
// asks the server to pick (src/routes/avatar.ts).

const avatarFields = [
  'headWidth',
  'skin',
  'hairType',
  'hairColor',
  'eyeType',
  'eyeColor',
  'pupilColor',
  'toothType',
  'toothColor',
] as const

// The avatar the fields describe. Unchecked: AvatarSvg checks every value itself and draws
// a default for anything it doesn't know, as it does for what comes from the database.
function fromFields(form: HTMLFormElement): Avatar {
  const data = new FormData(form)
  return Object.fromEntries(
    avatarFields.map((name) => [name, String(data.get(name) ?? '')]),
  ) as unknown as Avatar
}

function fill(form: HTMLFormElement, avatar: Avatar): void {
  for (const name of avatarFields) {
    const field = form.elements.namedItem(name)
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
      field.value = avatar[name]
    }
  }
}

const sameAvatar = (a: Avatar, b: Avatar) => avatarFields.every((name) => a[name] === b[name])

export function liveAvatarForm(form: HTMLFormElement, page: PageContext): LiveForm {
  let saved = fromFields(form)
  let shown = saved
  let frame = 0
  // A colour picker sends `input` many times a second: draw at most once a frame.
  const draw = () => {
    frame = 0
    const avatar = fromFields(form)
    if (!sameAvatar(avatar, shown)) {
      shown = avatar
      showOwnAvatars(avatar, page)
    }
  }
  return {
    show: () => {
      frame ||= requestAnimationFrame(draw)
    },
    saved: (data) => {
      if (data?.avatar) {
        saved = data.avatar as Avatar
      }
    },
    revert: () => {
      cancelAnimationFrame(frame)
      fill(form, saved)
      draw()
    },
    submit: (submitter) => {
      if (submitter?.getAttribute('name') !== 'random') {
        return submitter
      }
      fill(
        form,
        randomAvatarWith((count) => Math.floor(Math.random() * count)),
      )
      cancelAnimationFrame(frame)
      draw()
      // Saved as the fields are now, like the "Save" button.
      return null
    },
  }
}
