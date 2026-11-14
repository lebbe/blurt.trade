import type { EnhancerContext } from './enhance.ts'
import { renderElement } from './render.ts'
import { html } from '../ui/html.ts'
import { ShareDialog } from '../ui/share.ts'
import { shareTargets } from '../shared/share.ts'

// Share (`<a data-enhance="share">`, on every blurt card and on profiles). Without
// JavaScript it is a link: to the blurt's page in lists, to the share card image on the
// blurt's own page and on a profile. With it, every Share shares the page itself
// (data-share-url, made absolute with the site's public origin) with data-share-title:
//   - on touch-first devices with a share sheet, the browser's own (navigator.share).
//     Desktop Safari and Chrome on Windows have navigator.share too, but there the popup
//     is the better fit, so it is used only when the main pointer is coarse. Cancelling
//     the sheet does nothing; any other failure opens the popup instead.
//   - otherwise a popup (ShareDialog, src/ui/share.ts) with links to share it elsewhere and
//     a Copy link button.
// A click with a modifier key or another mouse button is left to the browser (open the
// link in a new tab, say), as is anything before this module is ready.

export function enhance(link: HTMLElement, { page }: EnhancerContext): void {
  if (!(link instanceof HTMLAnchorElement) || !link.dataset.shareUrl) {
    return
  }
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    void share(link, page.origin || location.origin, page)
  })
}

function absolute(path: string, origin: string): string {
  return new URL(path, origin).href
}

async function share(
  link: HTMLAnchorElement,
  origin: string,
  page: EnhancerContext['page'],
): Promise<void> {
  const url = absolute(link.dataset.shareUrl!, origin)
  const title = link.dataset.shareTitle ?? ''
  if (typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ url, title, text: title })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      // Not allowed here, or the sheet failed: the popup does the same job.
    }
  }
  const media = link.dataset.shareMedia
  const targets = shareTargets({
    url,
    title,
    hasPicture: link.dataset.sharePicture !== undefined,
    media: media ? absolute(media, origin) : undefined,
  })
  openDialog(link, url, title, targets, page)
}

function openDialog(
  opener: HTMLElement,
  url: string,
  title: string,
  targets: ReturnType<typeof shareTargets>,
  page: EnhancerContext['page'],
): void {
  const dialog = renderElement<HTMLDialogElement>(
    html`<${ShareDialog} url=${url} title=${title} targets=${targets} />`,
    page,
  )
  const status = dialog.querySelector<HTMLElement>('.share-status')!
  const field = dialog.querySelector<HTMLInputElement>('#share-link')!

  dialog.addEventListener('click', (event) => {
    // The dialog has no padding of its own (.share-box fills it), so a click on the
    // dialog element itself is a click on the backdrop around it.
    if (event.target === dialog) {
      dialog.close()
      return
    }
    const copy = event.target instanceof Element && event.target.closest('[data-share-copy]')
    if (copy) {
      void copyLink(url, field, status)
    }
  })
  // A link opens its service in a new tab; the popup has done its job.
  dialog.addEventListener('click', (event) => {
    const target = event.target instanceof Element && event.target.closest('a[data-share-target]')
    if (target) {
      setTimeout(() => dialog.close(), 0)
    }
  })
  dialog.addEventListener('close', () => {
    dialog.remove()
    // Browsers put the focus back on what opened a modal dialog; this makes sure of it.
    if (opener.isConnected) {
      opener.focus()
    }
  })
  document.body.append(dialog)
  dialog.showModal()
}

async function copyLink(url: string, field: HTMLInputElement, status: HTMLElement) {
  // Emptied first, so the same message is read out again on a second press.
  status.textContent = ''
  try {
    if (!navigator.clipboard) {
      throw new Error('No clipboard here')
    }
    await navigator.clipboard.writeText(url)
    status.textContent = 'Copied!'
  } catch {
    // No clipboard (an insecure origin, an older browser) or not allowed: the link,
    // selected, for the visitor to copy themselves.
    field.focus()
    field.select()
    status.textContent = 'Press Ctrl+C (⌘C on a Mac) to copy the selected link.'
  }
}
