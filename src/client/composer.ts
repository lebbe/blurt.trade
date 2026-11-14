import type { FeedItem } from '../routes/state/blurts.ts'
import { blurtMaxLength, blurtMaxNewlines, charLength } from '../shared/limits.ts'
import { pictureSvg } from '../shared/picture/svg.ts'
import { ValidationError } from '../ui/forms.ts'
import { html } from '../ui/html.ts'
import { ListItem } from '../ui/lists.ts'
import { blurtUrl } from '../ui/urls.ts'
import { announce } from './announce.ts'
import type { EnhancerContext } from './enhance.ts'
import { withDates } from './json.ts'
import { renderElement, renderNodes } from './render.ts'
import { drawFile, previewNote } from './picture-preview.ts'
import { submitForm } from './requests.ts'

// <form data-enhance="composer">: the blurt form (Composer, src/pages/shared/composer.ts).
//
//   - The hint under the text box counts down the characters left (code points, as the
//     server counts them) and says when there are too many line breaks.
//   - Ctrl+Enter (Cmd+Enter on a Mac) sends it.
//   - A picture picked shows as the drawing it will become (drawn in the browser, in a
//     worker), with a button to take it away. The scaled-down picture is sent.
//   - Sending: the form goes with fetch() as it is (multipart, with the picture), and the
//     answer, the new blurt as a feed item (POST /api/blurts), is rendered with the same
//     card the list uses and put into the page's list (the element marked
//     data-new-blurts: the top of a feed, the end of a thread's replies). The text box is
//     emptied, the focus moves to the new blurt and the live region says it is posted.
//     While the server draws the picture (it takes a moment) the form says so. The
//     server always draws it itself: the browser's is only a preview.
//   - Errors (`{ errors }`) show at the top of the form, as the server's page would.
//     Anything else is the ordinary submission (requests.ts, 'fallback').
//   - A quote still goes to the new quote's page, as without JavaScript: there is no list
//     for it on the page it is written on.

// For the hints' ids, one per composer on the page.
let composers = 0

function hintText(text: string): string {
  const left = blurtMaxLength - charLength(text)
  const lines = (text.match(/\n/g) ?? []).length
  const count =
    left >= 0
      ? `${left} ${left === 1 ? 'character' : 'characters'} left`
      : `${-left} ${left === -1 ? 'character' : 'characters'} too many`
  const breaks = lines > blurtMaxNewlines ? ` · at most ${blurtMaxNewlines} line breaks` : ''
  return `${count}${breaks} · public`
}

export function enhance(form: HTMLFormElement, context: EnhancerContext): void {
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name=text]')
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')
  if (!textarea || !button) {
    throw new Error('Not a blurt form')
  }
  const file = form.querySelector<HTMLInputElement>('input[type=file][name=picture]')
  const hint = form.querySelector<HTMLElement>('.composer-hint')
  const reply = form.querySelector('input[name=parentId]') !== null
  const quote = form.querySelector('input[name=reblurtOfId]') !== null

  // The count, read with the text box (aria-describedby), not announced at every key.
  const count = () => {
    if (hint) {
      const text = hintText(textarea.value)
      hint.textContent = text
      const left = blurtMaxLength - charLength(textarea.value)
      hint.dataset.state =
        left < 0 || text.includes('line breaks') ? 'over' : left <= 20 ? 'low' : ''
    }
  }
  if (hint) {
    hint.id ||= `composer-hint-${++composers}`
    textarea.setAttribute('aria-describedby', hint.id)
  }
  textarea.addEventListener('input', count)
  count()

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      form.requestSubmit()
    }
  })

  // The picture picked, drawn as the server will draw it (in a worker, ./picture-preview.ts),
  // under the text box, with a button to take it away. The drawing also gives the picture
  // scaled down to the size it is drawn at, which is sent instead when it is smaller: less
  // to upload, and the server then draws the very pixels the preview was drawn from.
  let preview: HTMLElement | null = null
  let drawing: Promise<File | undefined> | undefined
  let picks = 0
  const clearPreview = () => {
    const image = preview?.querySelector('img')
    if (image?.src) {
      URL.revokeObjectURL(image.src)
    }
    preview?.remove()
    preview = null
    drawing = undefined
    picks++
  }
  file?.addEventListener('change', () => {
    clearPreview()
    const picked = file.files?.[0]
    if (!picked || !picked.type.startsWith('image/')) {
      return
    }
    const pick = picks
    const shown = renderElement(
      html`<div class="picture-preview">
        <figure>
          <img alt="Preview of the drawing of your picture" hidden />
          <figcaption class="tiny" role="status">Drawing a preview…</figcaption>
        </figure>
        <button type="button" class="secondary">Remove picture</button>
      </div>`,
      context.page,
    )
    preview = shown
    shown.querySelector('button')?.addEventListener('click', () => {
      file.value = ''
      clearPreview()
      file.focus()
    })
    file.closest('.row')?.after(shown)
    const image = shown.querySelector('img')!
    const caption = shown.querySelector('figcaption')!
    drawing = drawFile(picked, { upload: true }).then(
      (result) => {
        if (pick !== picks) {
          return undefined
        }
        const svg = new Blob([pictureSvg(result.shapes)], { type: 'image/svg+xml' })
        image.width = result.width
        image.height = result.height
        image.src = URL.createObjectURL(svg)
        image.hidden = false
        caption.textContent = previewNote
        return result.upload && result.upload.size < picked.size
          ? new File([result.upload], 'picture.png', { type: 'image/png' })
          : undefined
      },
      () => {
        if (pick === picks) {
          caption.textContent =
            'No preview: this browser could not read the picture. It is drawn when you post.'
        }
        return undefined
      },
    )
  })

  if (quote) {
    return
  }

  const status = renderElement(html`<p class="composer-status" role="status"></p>`, context.page)
  button.closest('.row')?.after(status)

  let sending = false
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!sending) {
      void send(event.submitter)
    }
  })

  async function send(submitter: HTMLElement | null): Promise<void> {
    sending = true
    const withPicture = Boolean(file?.files?.length)
    button!.disabled = true
    form.setAttribute('aria-busy', 'true')
    status.textContent = withPicture ? 'Drawing your picture…' : 'Posting…'
    // The picture scaled down by the preview, if it is ready soon enough to be worth it.
    const scaled = withPicture && drawing ? await drawing : undefined
    const outcome = await submitForm<FeedItem>(form, {
      submitter,
      ...(scaled && { files: { picture: scaled } }),
    })
    if (outcome.kind === 'fallback') {
      return // the page is being submitted for real
    }
    sending = false
    button!.disabled = false
    form.removeAttribute('aria-busy')
    status.textContent = ''
    form.querySelector(':scope > .validation-error')?.remove()

    if (outcome.kind === 'errors') {
      const message = outcome.errors.map((error) => error.message).join(' ')
      form.prepend(...renderNodes(html`<${ValidationError} message=${message} />`, context.page))
      textarea!.focus()
      return
    }
    if (outcome.kind !== 'success' || !outcome.data) {
      return
    }
    const blurt = withDates(outcome.data)
    textarea!.value = ''
    if (file) {
      file.value = ''
    }
    clearPreview()
    count()
    show(blurt)
  }

  // The new blurt in the page's list, or where it can be seen when the page has none.
  function show(blurt: FeedItem): void {
    const list = document.querySelector<HTMLElement>(
      reply ? '[data-new-blurts="end"]' : '[data-new-blurts="start"]',
    )
    const what = reply ? 'Your reply is posted.' : 'Your blurt is posted.'
    if (!list) {
      status.replaceChildren(
        `${what} `,
        renderElement(html`<a href=${blurtUrl(blurt)}>See it</a>`, context.page),
      )
      announce(what)
      return
    }
    const card = renderElement(
      html`<${ListItem}
        kind=${reply ? 'replies' : 'feed'}
        item=${blurt}
        viewer=${context.page.viewer}
      />`,
      context.page,
    )
    card.dataset.posted = ''
    list.querySelector(':scope > p.empty')?.remove()
    // Under the "N new blurts" banner (./new-blurts.ts) if there is one, else the heading.
    const heading = list.querySelector(':scope > .new-blurts') ?? list.querySelector(':scope > h2')
    if (reply) {
      list.append(card)
    } else if (heading) {
      heading.after(card)
    } else {
      list.prepend(card)
    }
    void context.enhance(card)
    card.tabIndex = -1
    card.focus()
    announce(what)
  }
}
