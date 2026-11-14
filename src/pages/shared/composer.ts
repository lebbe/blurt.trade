import { siteDescription } from './layout.ts'
import { blurtMaxLength } from '../../shared/limits.ts'
import { html } from '../../ui/html.ts'
import { Icon } from '../../ui/icons.ts'

// The blurt form on the feed, blurt and near pages.

// `parentId` makes it a reply form, `reblurtOfId` a quote form. `label` names the text
// box for screen readers; `id` is the panel's, for links to it (#quote).
export type ComposerProps = {
  text?: string
  validationError?: string
  parentId?: number
  reblurtOfId?: number
  heading?: string
  label?: string
  placeholder?: string
  button?: string
  id?: string
}

// A blurt form in its own panel: the first thing on the pages people read blurts on.
//
// With JavaScript (src/client/composer.ts) it counts characters, sends on Ctrl/Cmd+Enter,
// shows the chosen picture, and posts without a page load: the new blurt is put into the
// list on the page (the element marked data-new-blurts). Quotes still go to their page.
export function Composer({
  text = '',
  validationError,
  parentId,
  reblurtOfId,
  heading = 'Blurt now',
  label = 'Blurt',
  button = 'Blurt it',
  placeholder = siteDescription,
  id,
}: ComposerProps) {
  return html`
    <section class="panel composer" id=${id}>
      <h2>${heading}</h2>
      <form
        method="post"
        action="/api/blurts"
        enctype="multipart/form-data"
        data-enhance="composer"
      >
        ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
        ${parentId !== undefined && html`<input type="hidden" name="parentId" value=${parentId} />`}
        ${
          reblurtOfId !== undefined &&
          html`<input type="hidden" name="reblurtOfId" value=${reblurtOfId} />`
        }
        <textarea
          name="text"
          maxlength=${blurtMaxLength}
          required
          aria-label=${label}
          placeholder=${placeholder}
        >
${text}</textarea>
        <span class="tiny composer-hint">${blurtMaxLength} characters max · public</span>
        <div class="row">
          <input
            type="file"
            name="picture"
            class="picture-field"
            aria-label="Picture (optional)"
            accept="image/jpeg,image/png,image/webp"
          />
          <button type="submit" class="blurt-button">
            <${Icon} name=${parentId === undefined ? 'megaphone' : 'reply'} /><span>${button}</span>
          </button>
        </div>
      </form>
    </section>
  `
}
