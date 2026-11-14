import { html } from './html.ts'
import type { ShareTarget } from '../shared/share.ts'

// The Share popup on computers and tablets (src/client/share.ts opens it as a modal
// <dialog>; phones get the browser's own share sheet instead). Plain links to each
// service's share page (src/shared/share.ts): no scripts, frames or widgets of theirs, so
// nothing reaches them until one is clicked. Each opens in a new tab, without telling the
// service where it came from beyond the address being shared. Under them the address
// itself, to copy: the Copy button fills the status line, which is read out.
export function ShareDialog({
  url,
  title,
  targets,
}: {
  url: string
  title: string
  targets: ShareTarget[]
}) {
  return html`<dialog class="share" aria-labelledby="share-heading">
    <div class="share-box">
      <h2 id="share-heading">Share</h2>
      ${title && html`<p class="share-title">${title}</p>`}
      <ul class="share-targets">
        ${targets.map(
          (target) =>
            html`<li>
              <a
                href=${target.href}
                data-share-target=${target.id}
                target=${target.id === 'email' ? undefined : '_blank'}
                rel="noopener noreferrer"
                >${target.name}</a
              >
            </li>`,
        )}
      </ul>
      <div class="share-copy">
        <label for="share-link">Link</label>
        <div class="share-copy-row">
          <input id="share-link" type="url" readonly value=${url} />
          <button type="button" data-share-copy autofocus>Copy link</button>
        </div>
        <p class="share-status" role="status" aria-live="polite"></p>
      </div>
      <form method="dialog" class="actions">
        <button type="submit" class="secondary">Close</button>
      </form>
    </div>
  </dialog>`
}
