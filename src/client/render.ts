import { render } from 'preact'
import type { PageContext } from '../ui/context.ts'
import { html } from '../ui/html.ts'
import { PageContextProvider } from './page-context.ts'

// Shared components (src/ui) rendered in the browser, to be put into server markup: the
// next page of a list, a new blurt, a card's buttons after a click. Preact renders into a
// detached holder inside the page context, and the nodes it made are moved out. The holder
// is never rendered into again, so Preact never looks for them there.

export function renderNodes(vnode: unknown, page: PageContext): ChildNode[] {
  const holder = document.createElement('div')
  render(html`<${PageContextProvider} value=${page}>${vnode}<//>`, holder)
  return [...holder.childNodes]
}

// The first element `vnode` renders to.
export function renderElement<E extends Element = HTMLElement>(
  vnode: unknown,
  page: PageContext,
): E {
  const element = renderNodes(vnode, page).find((node) => node instanceof Element) as E | undefined
  if (!element) {
    throw new Error('Nothing was rendered')
  }
  return element
}

// Puts what `vnode` renders in place of `old`, keeping the keyboard focus where it was: on
// the element at the same place in the new markup (a button the user just pressed).
export function replaceRendered(old: Element, vnode: unknown, page: PageContext): HTMLElement {
  const fresh = renderElement(vnode, page)
  const focused = document.activeElement
  const focusPath = focused && old.contains(focused) ? pathTo(old, focused) : null
  old.replaceWith(fresh)
  if (focusPath) {
    const target = focusPath.reduce<Element | undefined>(
      (element, index) => element?.children[index],
      fresh,
    )
    ;(target instanceof HTMLElement ? target : fresh).focus()
  }
  return fresh
}

function pathTo(root: Element, element: Element): number[] {
  const path: number[] = []
  for (let node = element; node !== root && node.parentElement; node = node.parentElement) {
    path.unshift([...node.parentElement.children].indexOf(node))
  }
  return path
}
