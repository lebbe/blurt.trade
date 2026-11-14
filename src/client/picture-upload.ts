import { type Avatar, defaultPictureCut, maxPictureCut, minPictureCut } from '../shared/avatar.ts'
import { photoPartSvg } from '../shared/picture/svg.ts'
import { AvatarView, cutHint } from '../ui/avatar.ts'
import { ValidationError } from '../ui/forms.ts'
import { html } from '../ui/html.ts'
import { ProfilePictureForm } from '../ui/profile-picture.ts'
import { announce } from './announce.ts'
import { showOwnAvatars } from './avatar-preview.ts'
import type { EnhancerContext } from './enhance.ts'
import { latest, previewNote, type Crop, type PictureResult } from './picture-preview.ts'
import { renderElement, renderNodes } from './render.ts'
import { submitForm, type Outcome } from './requests.ts'

// <form class="picture-upload" data-enhance="picture-upload">: the profile picture's
// upload form (ProfilePictureForm, src/ui/profile-picture.ts). Without JavaScript the file
// goes up as it is, the server crops its middle square, and the mouth is set by clicking
// the picture afterwards. With this, once a file is picked, before anything is uploaded:
//
//   - Crop: the picture with a square frame over it, moved by dragging (mouse or touch),
//     resized by dragging its corner or with the Size slider; from the keyboard the arrow
//     keys move it (Shift: faster) and + and - resize it.
//   - The drawing of that square, made in the browser (./picture-preview.ts, a worker),
//     with the mouth's line: a click on it or the up and down arrows put the line there.
//   - The talking avatar it will make (AvatarView with the drawing's halves as blob: URLs),
//     which flaps on hover as it will on every page.
//
// Upload sends one request: the cropped square, scaled to the 640 × 640 the server draws
// at, as a PNG in `picture`, and `cut`. The browser crops rather than sending the crop as
// fields, because the server then needs no crop logic at all: it crops the middle square
// of whatever it gets, and of a square that is the whole of it. The answer `{ avatar }`
// draws the panel again (the same component the server renders it with) and every other
// place the avatar is shown; nothing reloads.
//
// A picture the browser can't read (an image format it doesn't know) gets no editor: the
// form is sent as without JavaScript.

const pictureUrl = /\/profile-pictures\/\d+-\d+-(\d+)-edit\.svg$/

// The size the crop view is drawn at, at most, in CSS pixels (CSS shrinks it further on
// narrow screens; pointer positions are scaled by the size it really has).
const viewSize = 320
// How near the frame's lower right corner (CSS pixels) a drag resizes it.
const handleReach = 28
// The smallest crop, as a share of the picture's shorter side.
const minCropShare = 0.1

function clampCut(cut: number): number {
  return Math.min(maxPictureCut, Math.max(minPictureCut, Math.round(cut)))
}

// The cut of the stored picture, if there is one on the page, else the default.
function currentCut(root: ParentNode): number {
  const input = root.querySelector<HTMLInputElement>('form.cut-form input[name=cut]')
  const match = input && pictureUrl.exec(new URL(input.src).pathname)
  return match ? Number(match[1]) : defaultPictureCut
}

type Editor = {
  file: File
  crop: () => Crop
  cut: () => number
  // The drawing of the frame as it is, once the preview has caught up with it.
  upload: () => PictureResult | undefined
  remove: () => void
}

export function enhance(element: HTMLElement, context: EnhancerContext): void {
  if (!(element instanceof HTMLFormElement)) {
    throw new Error('picture-upload needs a <form>')
  }
  const form = element
  const input = form.querySelector<HTMLInputElement>('input[type=file][name=picture]')
  const section = form.closest<HTMLElement>('section#picture')
  if (!input || !section) {
    throw new Error('picture-upload: no file field')
  }
  let editor: Editor | undefined

  input.addEventListener('change', () => {
    editor?.remove()
    editor = undefined
    const file = input.files?.[0]
    if (file && file.type.startsWith('image/')) {
      void openEditor(file).then((opened) => {
        // Only if no other file was picked meanwhile.
        if (input.files?.[0] === file) {
          editor = opened
        } else {
          opened?.remove()
        }
      })
    }
  })

  async function openEditor(file: File): Promise<Editor | undefined> {
    let full: ImageBitmap
    try {
      full = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      return undefined // the browser can't read it: the form goes as it is
    }
    const source = { width: full.width, height: full.height }
    const scale = Math.min(1, viewSize / Math.max(source.width, source.height))
    const view = {
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale)),
    }
    const shown = await createImageBitmap(full, {
      resizeWidth: view.width,
      resizeHeight: view.height,
      resizeQuality: 'high',
    })
    full.close()

    const shorter = Math.min(source.width, source.height)
    // The middle square, as the server would crop it.
    let crop: Crop = {
      x: Math.round((source.width - shorter) / 2),
      y: Math.round((source.height - shorter) / 2),
      size: shorter,
    }
    let cut = currentCut(section!)

    const box = renderElement(
      html`<div class="picture-crop">
        <div class="crop-stage">
          <canvas
            class="crop-canvas"
            width=${view.width}
            height=${view.height}
            tabindex="0"
            role="img"
            aria-label="Your picture, with a square frame around the part that is used"
            aria-describedby="crop-help"
          ></canvas>
          <p class="tiny" id="crop-help">
            Drag the frame to move it, or its corner to resize it. With the keyboard: the arrow keys
            move it (with Shift in bigger steps), + and − resize it.
          </p>
          <label class="crop-size"
            >Size
            <input type="range" min=${Math.round(minCropShare * 100)} max="100" value="100" />
          </label>
          <p class="tiny crop-status" role="status"></p>
        </div>
        <div class="crop-result">
          <img
            class="crop-drawing"
            tabindex="0"
            width="240"
            height="240"
            alt="Preview of the drawing: click where the mouth should open"
            aria-describedby="crop-cut-help"
            hidden
          />
          <p class="tiny cut-hint">${cutHint(cut)}</p>
          <p class="tiny" id="crop-cut-help">
            With the keyboard: the up and down arrows move the mouth's line.
          </p>
          <div class="avatar-preview"></div>
          <p class="tiny crop-note" role="status">Drawing a preview…</p>
        </div>
      </div>`,
      context.page,
    )
    input!.closest('label')?.after(box)
    const canvas = box.querySelector('canvas')!
    const range = box.querySelector<HTMLInputElement>('input[type=range]')!
    const cropStatus = box.querySelector('.crop-status')!
    const drawingImage = box.querySelector<HTMLImageElement>('img.crop-drawing')!
    const hint = box.querySelector('.cut-hint')!
    const avatarHolder = box.querySelector('.avatar-preview')!
    const note = box.querySelector('.crop-note')!
    const paint = canvas.getContext('2d')!

    // The crop view: the picture, dimmed outside the frame, the frame and its corner.
    const showCrop = () => {
      const [x, y, size] = [crop.x * scale, crop.y * scale, crop.size * scale]
      paint.clearRect(0, 0, view.width, view.height)
      paint.drawImage(shown, 0, 0)
      paint.fillStyle = 'rgba(0, 0, 0, 0.55)'
      paint.beginPath()
      paint.rect(0, 0, view.width, view.height)
      paint.rect(x + size, y, -size, size) // the other way round: a hole
      paint.fill('evenodd')
      paint.strokeStyle = '#ffffff'
      paint.lineWidth = 2
      paint.strokeRect(x + 1, y + 1, size - 2, size - 2)
      paint.fillStyle = '#ffffff'
      paint.fillRect(x + size - 12, y + size - 12, 12, 12)
      range.value = String(Math.round((crop.size / shorter) * 100))
    }
    const describeCrop = () => {
      cropStatus.textContent = `Square of ${crop.size} × ${crop.size} pixels, ${crop.x} from the left and ${crop.y} from the top.`
    }

    const setCrop = (next: Crop) => {
      const size = Math.round(Math.min(shorter, Math.max(shorter * minCropShare, next.size)))
      crop = {
        size,
        x: Math.round(Math.min(source.width - size, Math.max(0, next.x))),
        y: Math.round(Math.min(source.height - size, Math.max(0, next.y))),
      }
      showCrop()
      redraw()
    }
    // Resized about its middle (slider and keyboard).
    const resizeTo = (size: number) => {
      const middle = { x: crop.x + crop.size / 2, y: crop.y + crop.size / 2 }
      const clamped = Math.min(shorter, Math.max(shorter * minCropShare, size))
      setCrop({ x: middle.x - clamped / 2, y: middle.y - clamped / 2, size: clamped })
    }

    // The drawing: only the newest one asked for is shown.
    const draw = latest()
    let result: PictureResult | undefined
    let resultCrop: Crop | undefined
    let urls: string[] = []
    let failed = false
    const showDrawing = () => {
      if (!result) {
        return
      }
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
      const blob = (part: 'top' | 'jaw' | 'edit') =>
        URL.createObjectURL(
          new Blob([photoPartSvg(result!.shapes, cut, part)], { type: 'image/svg+xml' }),
        )
      const parts = { top: blob('top'), jaw: blob('jaw') }
      const edit = blob('edit')
      urls = [parts.top, parts.jaw, edit]
      drawingImage.src = edit
      drawingImage.hidden = false
      hint.textContent = cutHint(cut)
      // Only the photo is looked at, and of it only the cut: the halves come from `parts`.
      const preview = { photo: { user: 0, version: 0, cut } } as Avatar
      avatarHolder.replaceChildren(
        ...renderNodes(
          html`<${AvatarView}
              avatar=${preview}
              parts=${parts}
              label="Preview of your profile picture"
              size="large"
            />
            <p class="empty">Hover it to hear it talk.</p>`,
          context.page,
        ),
      )
    }
    const redraw = () => {
      const asked = { ...crop }
      const started = performance.now()
      void draw(file, { crop: asked, upload: true }).then(
        (drawn) => {
          if (!drawn) {
            return // a newer one is on its way
          }
          result = drawn
          resultCrop = asked
          failed = false
          note.textContent = previewNote
          // Kept for the notes on how long drawing takes in the browser.
          canvas.dataset.drawnMs = String(Math.round(performance.now() - started))
          showDrawing()
        },
        () => {
          failed = true
          note.textContent =
            'No preview: the picture could not be drawn here. It is drawn when you upload it.'
        },
      )
    }

    // Pointer: drag inside the frame to move it, near its corner to resize it, anywhere
    // else to bring it there.
    let drag: { mode: 'move' | 'resize'; dx: number; dy: number } | undefined
    const pointAt = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((event.clientX - rect.left) / (rect.width || 1)) * source.width,
        y: ((event.clientY - rect.top) / (rect.height || 1)) * source.height,
        perPixel: source.width / (rect.width || 1),
      }
    }
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      canvas.focus()
      canvas.setPointerCapture(event.pointerId)
      const { x, y, perPixel } = pointAt(event)
      const corner = { x: crop.x + crop.size, y: crop.y + crop.size }
      if (Math.hypot(x - corner.x, y - corner.y) <= handleReach * perPixel) {
        drag = { mode: 'resize', dx: corner.x - x, dy: corner.y - y }
        return
      }
      const inside = x >= crop.x && y >= crop.y && x <= corner.x && y <= corner.y
      if (!inside) {
        setCrop({ ...crop, x: x - crop.size / 2, y: y - crop.size / 2 })
      }
      drag = { mode: 'move', dx: crop.x - x, dy: crop.y - y }
    })
    canvas.addEventListener('pointermove', (event) => {
      const { x, y, perPixel } = pointAt(event)
      if (!drag) {
        const corner = { x: crop.x + crop.size, y: crop.y + crop.size }
        canvas.dataset.cursor =
          Math.hypot(x - corner.x, y - corner.y) <= handleReach * perPixel ? 'resize' : 'move'
        return
      }
      if (drag.mode === 'move') {
        setCrop({ ...crop, x: x + drag.dx, y: y + drag.dy })
      } else {
        // The corner follows the pointer; the frame stays square and in the picture.
        const size = Math.min(
          x + drag.dx - crop.x,
          y + drag.dy - crop.y,
          source.width - crop.x,
          source.height - crop.y,
        )
        setCrop({ ...crop, size })
      }
    })
    const endDrag = () => {
      if (drag) {
        drag = undefined
        describeCrop()
      }
    }
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)

    canvas.addEventListener('keydown', (event) => {
      const step = Math.max(1, Math.round(shorter * (event.shiftKey ? 0.1 : 0.02)))
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      if (event.key in moves) {
        const [dx, dy] = moves[event.key]
        setCrop({ ...crop, x: crop.x + dx, y: crop.y + dy })
      } else if (event.key === '+' || event.key === '=') {
        resizeTo(crop.size + shorter * 0.05)
      } else if (event.key === '-' || event.key === '_') {
        resizeTo(crop.size - shorter * 0.05)
      } else {
        return
      }
      event.preventDefault()
      describeCrop()
    })
    range.addEventListener('input', () => {
      resizeTo((Number(range.value) / 100) * shorter)
    })
    range.addEventListener('change', describeCrop)

    // The mouth: a click on the drawing, or the up and down arrows.
    const setCut = (next: number) => {
      cut = clampCut(next)
      showDrawing()
    }
    drawingImage.addEventListener('click', (event) => {
      const height = drawingImage.clientHeight || 1
      setCut((event.offsetY * 100) / height)
    })
    drawingImage.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return
      }
      event.preventDefault()
      const by = event.shiftKey ? 5 : 1
      setCut(cut + (event.key === 'ArrowUp' ? -by : by))
    })

    showCrop()
    describeCrop()
    redraw()

    return {
      file,
      crop: () => crop,
      cut: () => cut,
      upload: () => (result && !failed && sameCrop(resultCrop, crop) ? result : undefined),
      remove: () => {
        for (const url of urls) {
          URL.revokeObjectURL(url)
        }
        shown.close()
        box.remove()
      },
    }
  }

  // Sending: the upload with the crop and cut, or the removal, both without a page load.
  let sending = false
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!sending) {
      void send(event.submitter)
    }
  })

  async function send(submitter: HTMLElement | null): Promise<void> {
    sending = true
    const removing = submitter?.getAttribute('name') === 'remove'
    const open = removing ? undefined : editor
    const status = statusLine()
    status.textContent = removing ? 'Removing…' : 'Drawing your picture…'
    form.setAttribute('aria-busy', 'true')
    let files: Record<string, File> | undefined
    let fields: Record<string, string> | undefined
    if (open) {
      fields = { cut: String(open.cut()) }
      const ready = open.upload() ?? (await finalDrawing(open))
      if (ready?.upload) {
        files = { picture: new File([ready.upload], 'picture.png', { type: 'image/png' }) }
      }
    }
    const outcome = await submitForm<{ avatar?: Avatar }>(form, { submitter, files, fields })
    sending = false
    form.removeAttribute('aria-busy')
    answered(outcome, removing)
  }

  // The drawing of the frame as it is now, if the preview hasn't caught up yet.
  async function finalDrawing(open: Editor): Promise<PictureResult | undefined> {
    try {
      return await latest()(open.file, { crop: open.crop(), upload: true })
    } catch {
      return undefined // then the original goes, cropped by the server
    }
  }

  function statusLine(): HTMLElement {
    let line = form.querySelector<HTMLElement>('.picture-upload-status')
    if (!line) {
      line = renderElement(
        html`<p class="tiny picture-upload-status" role="status"></p>`,
        context.page,
      )
      form.querySelector('.actions')?.after(line)
    }
    return line
  }

  function answered(outcome: Outcome<{ avatar?: Avatar }>, removing: boolean): void {
    if (outcome.kind === 'fallback') {
      return // the page is being submitted for real
    }
    form.querySelector(':scope > .validation-error')?.remove()
    section!.querySelector(':scope > .validation-error')?.remove()
    const avatar = outcome.kind === 'success' ? outcome.data?.avatar : undefined
    if (avatar) {
      editor?.remove()
      editor = undefined
      const fresh = renderElement(html`<${ProfilePictureForm} avatar=${avatar} />`, context.page)
      section!.replaceWith(fresh)
      showOwnAvatars(avatar, context.page)
      void context.enhance(fresh)
      fresh.tabIndex = -1
      fresh.focus()
      announce(removing ? 'Your profile picture is removed.' : 'Your profile picture is saved.')
      return
    }
    statusLine().textContent = ''
    const message =
      outcome.kind === 'errors'
        ? outcome.errors.map((error) => error.message).join(' ')
        : 'Not saved: no answer from the server. Try again.'
    form.prepend(...renderNodes(html`<${ValidationError} message=${message} />`, context.page))
    input!.focus()
  }
}

function sameCrop(a: Crop | undefined, b: Crop): boolean {
  return a !== undefined && a.x === b.x && a.y === b.y && a.size === b.size
}
