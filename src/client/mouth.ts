import {
  cutImageSize,
  maxPictureCut,
  minPictureCut,
  photoUrl,
  type Avatar,
  type AvatarPhoto,
} from '../shared/avatar.ts'
import { cutHint } from '../ui/avatar.ts'
import { showProfilePicture } from './avatar-preview.ts'
import type { EnhancerContext } from './enhance.ts'
import { submitForm, type Outcome } from './requests.ts'

// <form class="cut-form" data-enhance="mouth">: where the profile picture opens its mouth.
// Without JavaScript a click on the picture submits the pixel and the edit page comes
// back. With this, the same POST goes with fetch(); the answer `{ avatar }` gives the new
// cut, so the picture (whose URL holds the cut) shows the line there, the talking preview
// is drawn again with AvatarView, and the "now N% from the top" line follows.
//
// The keyboard: with the picture focused, the up and down arrows move the line 1% (with
// Shift 5%), showing it straight away; Enter or Space saves it there.

const pictureUrl = /\/profile-pictures\/(\d+)-(\d+)-(\d+)-edit\.svg$/

function photoFrom(input: HTMLInputElement): AvatarPhoto | null {
  const match = pictureUrl.exec(new URL(input.src).pathname)
  return match ? { user: Number(match[1]), version: Number(match[2]), cut: Number(match[3]) } : null
}

function clampCut(cut: number): number {
  return Math.min(maxPictureCut, Math.max(minPictureCut, cut))
}

const keyHelp =
  'With the keyboard: the up and down arrows move the line (with Shift in bigger steps), Enter or Space saves it.'

export function enhance(element: HTMLElement, context: EnhancerContext): void {
  if (!(element instanceof HTMLFormElement)) {
    throw new Error('mouth needs a <form>')
  }
  const form = element
  const input = form.querySelector<HTMLInputElement>('input[type=image][name=cut]')
  const hint = form.querySelector('.cut-hint')
  const saved = input && photoFrom(input)
  if (!input || !hint || !saved) {
    throw new Error('mouth: no picture')
  }
  let photo: AvatarPhoto = saved
  let pending = photo.cut

  const help = document.createElement('p')
  help.className = 'tiny'
  help.id = `cut-keys-${Math.random().toString(36).slice(2)}`
  help.textContent = keyHelp
  hint.after(help)
  input.setAttribute('aria-describedby', help.id)

  const message = document.createElement('p')
  message.setAttribute('role', 'status')
  message.className = 'tiny'
  help.after(message)
  const say = (text: string, error = false) => {
    message.textContent = text
    message.classList.toggle('validation-error', error)
  }

  const showCut = (cut: number) => {
    input.src = photoUrl({ ...photo, cut }, 'edit')
  }

  const answered = (outcome: Outcome<{ avatar?: Avatar }>) => {
    if (outcome.kind === 'fallback') {
      return
    }
    const avatar = outcome.kind === 'success' ? outcome.data?.avatar : undefined
    if (avatar?.photo) {
      photo = avatar.photo
      pending = photo.cut
      showCut(photo.cut)
      hint.textContent = cutHint(photo.cut)
      showProfilePicture(form.closest('.picture-editor') ?? document, avatar, context.page)
      say('Saved.')
    } else if (outcome.kind === 'errors') {
      showCut(photo.cut)
      pending = photo.cut
      say(outcome.errors.map((error) => error.message).join(' '), true)
    } else {
      // Saved, but no picture any more (removed in another tab): the page is out of date.
      showCut(photo.cut)
      say('Not saved: no answer from the server. Try again.', true)
    }
  }

  // One at a time; of the clicks made meanwhile, only the newest is sent.
  let busy = false
  let next: Record<string, string> | null = null
  const send = async (fields: Record<string, string>): Promise<void> => {
    if (busy) {
      next = fields
      return
    }
    busy = true
    say('Saving…')
    try {
      answered(await submitForm(form, { submitter: input, fields, fallback: false }))
    } finally {
      busy = false
    }
    const queued = next
    next = null
    if (queued) {
      await send(queued)
    }
  }

  input.addEventListener('click', (event) => {
    event.preventDefault()
    if (event.detail === 0) {
      // From the keyboard: the line where the arrows left it.
      void send({ cut: String(pending) })
      return
    }
    const x = Math.floor((event.offsetX * cutImageSize) / (input.clientWidth || cutImageSize))
    const y = Math.floor((event.offsetY * cutImageSize) / (input.clientHeight || cutImageSize))
    if (x < 0 || y < 0 || x >= cutImageSize || y >= cutImageSize) {
      return
    }
    void send({ 'cut.x': String(x || 1), 'cut.y': String(y) })
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void send({ cut: String(pending) })
  })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }
    event.preventDefault()
    const by = event.shiftKey ? 5 : 1
    pending = clampCut(pending + (event.key === 'ArrowUp' ? -by : by))
    showCut(pending)
    say(`${pending}% from the top: press Enter to save.`)
  })
  input.addEventListener('blur', () => {
    if (pending !== photo.cut) {
      pending = photo.cut
      showCut(photo.cut)
      say('')
    }
  })
}
