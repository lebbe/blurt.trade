import { render } from 'preact'
import type { Avatar } from '../shared/avatar.ts'
import { AvatarSvg, AvatarView } from '../ui/avatar.ts'
import { html } from '../ui/html.ts'
import type { PageContext } from '../ui/context.ts'
import { PageContextProvider } from './page-context.ts'

// The avatar previews on the edit page drawn again in the browser after a save, from the
// `{ avatar }` the server answered with and the same components the server drew them with
// (src/ui/avatar.ts), so the preview is what every page will now show.

// Renders `vnode` and puts what it made in place of `old` (server markup, not Preact's,
// so it can't be rendered into directly).
function replaceWith(old: Element, vnode: unknown, page: PageContext): void {
  const holder = document.createElement('div')
  render(html`<${PageContextProvider} value=${page}>${vnode}<//>`, holder)
  const fresh = holder.firstElementChild
  if (fresh) {
    old.replaceWith(fresh)
  }
}

// The cartoon's preview in the avatar form.
export function showAvatar(form: HTMLFormElement, avatar: Avatar, page: PageContext): void {
  const old = form.querySelector('.avatar-preview > .avatar')
  if (old) {
    replaceWith(old, html`<${AvatarSvg} avatar=${avatar} label="Your avatar" size="large" />`, page)
  }
}

// The profile picture's preview, next to the picture with the cut.
export function showProfilePicture(container: ParentNode, avatar: Avatar, page: PageContext): void {
  const old = container.querySelector('.avatar-preview > .avatar')
  if (old) {
    replaceWith(
      old,
      html`<${AvatarView} avatar=${avatar} label="Your profile picture" size="large" />`,
      page,
    )
  }
}
