import { render } from 'preact'
import type { Avatar } from '../shared/avatar.ts'
import { AvatarSvg, AvatarView } from '../ui/avatar.ts'
import { html } from '../ui/html.ts'
import type { PageContext } from '../ui/context.ts'
import { PageContextProvider } from './page-context.ts'

// The viewer's own avatar drawn again in the browser when it changes without a page load
// (the cartoon's fields, src/client/avatar-live.ts; the picture's mouth, mouth.ts), with the
// same components the server drew it with (src/ui/avatar.ts), so it is what every page will
// now show. The new SVG has the same classes as the old one, so it talks on hover the same
// way (public/style.css).

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

// Every place on the page that shows the viewer's avatar, each drawn as the server draws
// it there: the previews on the edit page (the cartoon's, in the avatar form, and the
// picture's), and the viewer's own blurts (found by the author's link).
export function showOwnAvatars(
  avatar: Avatar,
  page: PageContext,
  root: ParentNode = document,
): void {
  for (const old of root.querySelectorAll('.avatar-form .avatar-preview > .avatar')) {
    replaceWith(old, html`<${AvatarSvg} avatar=${avatar} label="Your avatar" size="large" />`, page)
  }
  for (const old of root.querySelectorAll('.picture-editor .avatar-preview > .avatar')) {
    replaceWith(
      old,
      html`<${AvatarView} avatar=${avatar} label="Your profile picture" size="large" />`,
      page,
    )
  }
  const username = page.viewer?.username
  if (!username) {
    return
  }
  for (const author of root.querySelectorAll<HTMLAnchorElement>('.blurt-meta strong > a')) {
    if (author.getAttribute('href') !== `/${username}/`) {
      continue
    }
    const old = author.closest('.blurt-main')?.querySelector(':scope > .avatar')
    if (old) {
      replaceWith(old, html`<${AvatarView} avatar=${avatar} />`, page)
    }
  }
}
