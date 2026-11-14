import type { Avatar } from '../shared/avatar.ts'
import { showAvatar } from './avatar-preview.ts'
import type { EnhancerContext } from './enhance.ts'
import { updatePageContext } from './page-context.ts'
import { submitForm, type FieldError, type Outcome } from './requests.ts'
import { applyTheme } from './theme.ts'
import { applyTimeSettings } from './times.ts'

// <form data-enhance="autosave">: the form saves itself, with no page load and no button.
// The settings forms on the edit page (profile and links, share card colour, avatar,
// time zone and language, theme, notifications).
//
//   - A select, radio, checkbox or colour saves when it changes.
//   - A text field saves when you leave it, and after a pause in typing (typingPause).
//   - The whole form is sent each time, exactly what its button would send (fields tied
//     to it with the `form` attribute too, like the share card colours), so the server
//     sees the same request as without JavaScript and needs no API of its own.
//   - One request per form at a time. A change while one is on its way waits for it,
//     then the form is sent as it is by then: the last state always wins, and an older
//     one can never overwrite a newer one. Nothing is sent when nothing changed since
//     the last save.
//   - The save buttons give way to a status line ("Saving…", "Saved", aria-live), hidden
//     by CSS keyed on what this marked (public/style.css), so without this script they
//     are still there. When a save fails they come back, and the errors from `{ errors }`
//     are shown at the fields they are about (else in the status line). A 429 says how
//     long to wait. Pressing a button (or Enter in a field) is an ordinary submission
//     again if fetch() fails, as without JavaScript (requests.ts, 'fallback').
//   - Buttons with a name (the avatar's "Random") still work, as a save with that button.

const typingPause = 800

// Inputs typed into, saved after a pause and on leaving them; everything else on change.
const typedTypes = new Set(['text', 'search', 'url', 'email', 'tel'])

function isTyped(element: EventTarget | null): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && typedTypes.has(element.type))
  )
}

type Data = Record<string, unknown> | null

// What a save changes on the page besides the form, by the form's action.
function afterSave(form: HTMLFormElement, data: Data, { page }: EnhancerContext): void {
  const path = new URL(form.action).pathname
  if (path === '/api/theme') {
    applyTheme(data?.theme, page)
  } else if (path === '/api/timezone') {
    if (data && 'locale' in data) {
      updatePageContext(page, { pickedLocale: (data.locale as string | null) ?? null })
    }
    applyTimeSettings(data?.display as { timeZone?: unknown; locale?: unknown }, page)
  } else if (path === '/api/avatar' && data?.avatar) {
    const avatar = data.avatar as Avatar
    // "Random" picked new values on the server: show them in the fields too.
    for (const [name, value] of Object.entries(avatar)) {
      const field = form.elements.namedItem(name)
      if (
        typeof value === 'string' &&
        (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
      ) {
        field.value = value
      }
    }
    showAvatar(form, avatar, page)
  }
}

// The form's fields as they would be sent (text only: these forms have no files).
function serialize(form: HTMLFormElement): string {
  return new URLSearchParams(
    [...new FormData(form)].filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString()
}

// The submit buttons without a name, the ones that only save: they become the status line.
function saveButtons(form: HTMLFormElement): HTMLButtonElement[] {
  return [...form.elements].filter(
    (element): element is HTMLButtonElement =>
      element instanceof HTMLButtonElement && element.type === 'submit' && !element.name,
  )
}

let errorIds = 0

// Shows errors at their fields: after the field's label (or its fieldset, for radios),
// tied to it with aria-describedby. Returns the messages that belong to no field here.
function showFieldErrors(form: HTMLFormElement, errors: FieldError[]): string[] {
  clearFieldErrors(form)
  const general: string[] = []
  for (const error of errors) {
    const named = error.field ? form.elements.namedItem(error.field) : null
    const field = named instanceof RadioNodeList ? named[0] : named
    if (!(field instanceof HTMLElement)) {
      general.push(error.message)
      continue
    }
    const message = document.createElement('p')
    message.className = 'validation-error'
    message.id = `autosave-error-${++errorIds}`
    message.dataset.autosaveError = ''
    message.textContent = error.message
    ;(field.closest('fieldset') ?? field.closest('label') ?? field).after(message)
    field.setAttribute('aria-invalid', 'true')
    field.setAttribute('aria-describedby', message.id)
    field.dataset.autosaveInvalid = ''
  }
  return general
}

function clearFieldErrors(form: HTMLFormElement): void {
  for (const message of document.querySelectorAll('[data-autosave-error]')) {
    const field = document.querySelector(`[aria-describedby="${message.id}"]`)
    if (field && (field as HTMLElement & { form?: HTMLFormElement }).form !== form) {
      continue
    }
    field?.removeAttribute('aria-invalid')
    field?.removeAttribute('aria-describedby')
    message.remove()
  }
}

// Why a save that got no answer the server meant for us failed.
function failure(outcome: Outcome<unknown>): string {
  if (outcome.kind === 'failed' && outcome.status === 401) {
    return 'Not saved: you are logged out. Log in again, then save.'
  }
  if (outcome.kind === 'failed' && outcome.status) {
    return 'Not saved: something went wrong on our side. Try again in a moment.'
  }
  return 'Not saved: no connection. Try again when you are back online.'
}

export function enhance(element: HTMLElement, context: EnhancerContext): void {
  if (!(element instanceof HTMLFormElement)) {
    throw new Error('autosave needs a <form>')
  }
  const form = element
  const buttons = saveButtons(form)

  // One status line in each save button's place (the share card has its own button,
  // outside the profile form), only the first one announced, so it's said once.
  const statuses = buttons.map((button, index) => {
    const status = document.createElement('span')
    status.className = 'autosave-status'
    if (index === 0) {
      status.setAttribute('role', 'status')
    } else {
      status.setAttribute('aria-hidden', 'true')
    }
    status.textContent = 'Saved as you change it.'
    button.after(status)
    return status
  })
  if (statuses.length === 0) {
    const status = document.createElement('p')
    status.className = 'autosave-status'
    status.setAttribute('role', 'status')
    form.append(status)
    statuses.push(status)
  }

  const show = (text: string, state: 'saving' | 'saved' | 'error') => {
    for (const status of statuses) {
      status.textContent = text
      status.dataset.state = state
    }
    // The buttons come back while the last save failed, to try again by hand.
    for (const button of buttons) {
      button.toggleAttribute('data-retry', state === 'error')
    }
  }

  let lastSaved = serialize(form)
  let saving = false
  let queued: { submitter: HTMLElement | null; explicit: boolean } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let leaving = false

  // `explicit`: a button or Enter asked for it, so it is sent even when nothing changed,
  // and a failed fetch() becomes the form's ordinary submission.
  const save = async (submitter: HTMLElement | null = null, explicit = false): Promise<void> => {
    clearTimeout(timer)
    if (saving) {
      // A button press beats a plain change; otherwise the newest call is as good as any,
      // since the form is read when it is sent.
      if (!queued?.explicit) {
        queued = { submitter, explicit }
      }
      return
    }
    const body = serialize(form)
    if (!explicit && body === lastSaved) {
      return
    }
    saving = true
    show('Saving…', 'saving')
    let outcome: Outcome<Data>
    try {
      outcome = await submitForm<Data>(form, { submitter, fallback: explicit })
    } finally {
      saving = false
    }
    if (outcome.kind === 'fallback') {
      leaving = true
      return
    }
    if (outcome.kind === 'success') {
      clearFieldErrors(form)
      afterSave(form, outcome.data, context)
      // After "Random" the fields hold the new avatar: that is what is saved now.
      lastSaved = serialize(form)
      show('Saved', 'saved')
    } else if (outcome.kind === 'errors') {
      const general = showFieldErrors(form, outcome.errors)
      show(general.length > 0 ? general.join(' ') : 'Not saved: see the message above.', 'error')
    } else {
      show(failure(outcome), 'error')
    }
    const next = queued
    queued = null
    if (next) {
      await save(next.submitter, next.explicit)
    }
  }

  // Changes come from the form's fields wherever they are in the page: a field tied to the
  // form with the `form` attribute is outside it, so its events never reach the form.
  const belongs = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement && (target as HTMLInputElement).form === form

  document.addEventListener('input', (event) => {
    if (belongs(event.target) && isTyped(event.target)) {
      clearTimeout(timer)
      timer = setTimeout(() => void save(), typingPause)
    }
  })
  document.addEventListener('change', (event) => {
    if (belongs(event.target)) {
      void save()
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void save(event.submitter, true)
  })
  // Leaving the page within the typing pause (or while a save is on its way): send what
  // is unsaved anyway, as a beacon, which outlives the page. Its answer is a redirect
  // nobody reads.
  window.addEventListener('pagehide', () => {
    const body = serialize(form)
    if (!leaving && body !== lastSaved && form.method.toLowerCase() === 'post') {
      navigator.sendBeacon(form.action, new URLSearchParams(body))
    }
  })

  // Only now that saving works do the buttons go (see public/style.css).
  for (const button of buttons) {
    button.dataset.autosaved = ''
  }
}
