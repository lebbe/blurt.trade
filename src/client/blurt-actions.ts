import type { Blurt } from '../routes/state/blurts.ts'
import { Likes, Reblurts, ReportedNote, ReportForm } from '../ui/blurt-card.ts'
import type { PageContext } from '../ui/context.ts'
import { html } from '../ui/html.ts'
import { announce } from './announce.ts'
import type { EnhancerContext } from './enhance.ts'
import { renderElement, replaceRendered } from './render.ts'
import { type FieldError, submitForm, submitForReal } from './requests.ts'

// <article class="blurt" data-enhance="blurt-actions">: a card's buttons (BlurtCard,
// src/ui/blurt-card.ts) without a page load. Each is the card's own form, sent with
// fetch() as it is.
//
//   - Like / Unlike, Reblurt / Undo reblurt: the button and count change at once (the
//     same Likes / Reblurts components, rendered with the new state), on every card of
//     that blurt on the page, then again from the server's answer. If the server refuses,
//     they go back and the live region says why; if it can't be reached, they go back and
//     the form is submitted for real.
//   - Delete opens a <dialog> to confirm (instead of the <details> it is without
//     JavaScript). Deleted, every card of the blurt leaves the page, as on the next load.
//     On the blurt's own page it is the ordinary submission: the server picks where to go.
//   - Report sends the reason; the form becomes "You reported this blurt.", or shows the
//     error as the server's page would.
//
// Replies inside a card are cards of their own, with their own enhancer: each one only
// handles the forms that belong to it.

type Toggle = 'like' | 'reblurt'

const toggles: Record<string, { kind: Toggle; on: boolean }> = {
  '/api/like': { kind: 'like', on: true },
  '/api/unlike': { kind: 'like', on: false },
  '/api/reblurt': { kind: 'reblurt', on: true },
  '/api/unreblurt': { kind: 'reblurt', on: false },
}

const deletePath = /^\/api\/blurts\/(\d+)\/delete$/

function pathOf(form: HTMLFormElement): string {
  return new URL(form.action).pathname
}

function blurtIdOf(form: HTMLFormElement): string {
  return (form.elements.namedItem('blurtId') as HTMLInputElement | null)?.value ?? ''
}

// What a Like or Reblurt form says now, as the part of a Blurt its component reads.
function readToggle(form: HTMLFormElement, kind: Toggle): Partial<Blurt> {
  const id = Number(blurtIdOf(form))
  const count = Number.parseInt(form.querySelector('.like-count')?.textContent ?? '0', 10) || 0
  const on = form.querySelector('button')?.getAttribute('aria-pressed') === 'true'
  if (kind === 'like') {
    return { id, likeCount: count, viewerLikes: on }
  }
  const article = form.closest('article')
  const author = article?.querySelector(
    ':scope > .blurt-main > .blurt-body > .blurt-meta > strong > a',
  )
  return {
    id,
    username: author?.textContent ?? null,
    deleted: false,
    reblurtCount: count,
    viewerReblurted: on,
  }
}

// Every Like (or Reblurt) form of this blurt on the page: it can be in more than one list.
function togglesOf(blurtId: string, kind: Toggle): HTMLFormElement[] {
  return [...document.querySelectorAll<HTMLFormElement>('form.like-form')].filter(
    (form) => toggles[pathOf(form)]?.kind === kind && blurtIdOf(form) === blurtId,
  )
}

function renderToggle(
  form: HTMLFormElement,
  kind: Toggle,
  state: Partial<Blurt>,
  page: PageContext,
): HTMLFormElement {
  const blurt = { ...readToggle(form, kind), ...state } as Blurt
  const vnode =
    kind === 'like'
      ? html`<${Likes} blurt=${blurt} viewer=${page.viewer} />`
      : html`<${Reblurts} blurt=${blurt} viewer=${page.viewer} />`
  // Reblurts also renders the Quote link next to its form; only the form changes.
  return replaceRendered(form, vnode, page) as HTMLFormElement
}

// The answer of /api/like etc. as the fields of a Blurt.
function answered(kind: Toggle, data: Record<string, unknown>): Partial<Blurt> {
  return kind === 'like'
    ? { likeCount: Number(data.likeCount), viewerLikes: Boolean(data.viewerLikes) }
    : { reblurtCount: Number(data.reblurtCount), viewerReblurted: Boolean(data.viewerReblurted) }
}

// Only the latest click on a blurt's button decides what it finally shows: an older answer
// arriving late is ignored.
const latest = new Map<string, number>()
let clicks = 0

async function toggle(form: HTMLFormElement, submitter: HTMLElement | null, page: PageContext) {
  const { kind, on } = toggles[pathOf(form)]
  const blurtId = blurtIdOf(form)
  const key = `${kind}:${blurtId}`
  const click = ++clicks
  latest.set(key, click)

  const before = readToggle(form, kind)
  const count = (kind === 'like' ? before.likeCount : before.reblurtCount) ?? 0
  const optimistic: Partial<Blurt> =
    kind === 'like'
      ? { likeCount: Math.max(0, count + (on ? 1 : -1)), viewerLikes: on }
      : { reblurtCount: Math.max(0, count + (on ? 1 : -1)), viewerReblurted: on }

  // The request is made from the form as it is, before it is rendered anew.
  const pending = submitForm<Record<string, unknown>>(form, { submitter, fallback: false })
  const index = togglesOf(blurtId, kind).indexOf(form)
  for (const other of togglesOf(blurtId, kind)) {
    renderToggle(other, kind, optimistic, page)
  }
  const outcome = await pending
  if (latest.get(key) !== click) {
    return
  }
  const state = outcome.kind === 'success' && outcome.data ? answered(kind, outcome.data) : before
  const rendered = togglesOf(blurtId, kind).map((other) => renderToggle(other, kind, state, page))
  if (outcome.kind === 'errors') {
    announce(messages(outcome.errors))
  } else if (outcome.kind === 'failed') {
    // Back as it was, and then what the button does without JavaScript.
    const again = rendered[index] ?? rendered[0]
    if (again) {
      submitForReal(again)
    }
  }
}

function messages(errors: FieldError[]): string {
  return errors.map((error) => error.message).join(' ')
}

async function report(form: HTMLFormElement, submitter: HTMLElement | null, page: PageContext) {
  const details = form.closest('details')
  const reason = (form.elements.namedItem('reason') as HTMLInputElement | null)?.value ?? ''
  const blurtId = blurtIdOf(form)
  const outcome = await submitForm(form, { submitter })
  if (!details) {
    return
  }
  if (outcome.kind === 'success') {
    // Every Report form of this blurt on the page: it is reported now, wherever it is.
    for (const other of document.querySelectorAll<HTMLFormElement>('form[action="/api/report"]')) {
      const holder = other.closest('details')
      if (holder && blurtIdOf(other) === blurtId) {
        holder.replaceWith(renderElement(html`<${ReportedNote} />`, page))
      }
    }
    announce('Reported. Thank you.')
  } else if (outcome.kind === 'errors') {
    const fresh = replaceRendered(
      details,
      html`<${ReportForm}
        blurt=${{ id: Number(blurtId) } as Blurt}
        error=${messages(outcome.errors)}
      />`,
      page,
    )
    const field = fresh.querySelector<HTMLInputElement>('input[name=reason]')
    if (field) {
      field.value = reason
      field.focus()
    }
  }
}

// The confirmation: Cancel (the default, and Escape) or Delete.
function confirmDelete(page: PageContext): Promise<boolean> {
  const dialog = renderElement<HTMLDialogElement>(
    html`<dialog class="confirm" aria-labelledby="confirm-delete-title">
      <p id="confirm-delete-title">Delete this blurt for good?</p>
      <form method="dialog" class="actions">
        <button type="submit" value="cancel" class="secondary" autofocus>Cancel</button>
        <button type="submit" value="delete" class="danger">Delete</button>
      </form>
    </dialog>`,
    page,
  )
  document.body.append(dialog)
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove()
      resolve(dialog.returnValue === 'delete')
    })
    dialog.showModal()
  })
}

async function remove(form: HTMLFormElement, opener: HTMLElement, page: PageContext) {
  const confirmed = await confirmDelete(page)
  if (!confirmed) {
    opener.focus()
    return
  }
  if (form.closest('.thread-main')) {
    submitForReal(form)
    return
  }
  const outcome = await submitForm(form)
  if (outcome.kind === 'errors') {
    announce(messages(outcome.errors))
    opener.focus()
    return
  }
  if (outcome.kind !== 'success') {
    return
  }
  const id = deletePath.exec(pathOf(form))?.[1]
  const cards = [...document.querySelectorAll<HTMLElement>(`article[id="blurt-${id}"]`)]
  // The focus goes to what comes after the card the button was on.
  const own = form.closest('article')
  const next = own?.nextElementSibling ?? own?.parentElement
  for (const card of cards) {
    card.remove()
  }
  if (next instanceof HTMLElement) {
    if (!next.matches('a, button, input, select, textarea, [tabindex]')) {
      next.tabIndex = -1
    }
    next.focus()
  }
  announce('Blurt deleted.')
}

export function enhance(article: HTMLElement, { page }: EnhancerContext): void {
  const ours = (element: Element) => element.closest('article') === article

  article.addEventListener('submit', (event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || !ours(form)) {
      return
    }
    const path = pathOf(form)
    if (Object.hasOwn(toggles, path)) {
      event.preventDefault()
      void toggle(form, event.submitter, page)
    } else if (path === '/api/report') {
      event.preventDefault()
      void report(form, event.submitter, page)
    }
  })

  // Delete's <summary> opens the dialog instead of its <details>.
  article.addEventListener('click', (event) => {
    const summary = event.target instanceof Element ? event.target.closest('summary') : null
    const form = summary?.parentElement?.querySelector('form')
    if (!summary || !form || !ours(summary) || !deletePath.test(pathOf(form))) {
      return
    }
    event.preventDefault()
    void remove(form, summary, page)
  })
}
