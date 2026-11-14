// Sending a form or following a link with fetch() instead of a page load, for enhancers.
//
// Every form and link already works without JavaScript, and the server answers the same
// request with JSON when asked for it (`Accept: application/json`, src/negotiate.ts):
// a POST that worked gives its data (or 204), one that didn't gives 4xx with
// `{ errors: [{ field?, message }] }` or `{ error, field? }`, and a GET page gives the
// data it was rendered from. So an enhancer sends exactly the request the browser would
// have sent, and only changes what happens with the answer.
//
// The contract:
//
//   - 'success': 2xx with JSON (data) or 204 (data null). Show the result in place.
//   - 'errors': 4xx with an error body (not 401). The request was understood and
//     refused; show the messages, as the re-rendered form would have.
//   - 'fallback': anything else (the network failed, a 5xx, a 401 because the session
//     ran out, a redirect, an answer that is not JSON). The helper has started the real
//     form submission or navigation, without any handler, so the browser does what it
//     would have done without JavaScript and shows whatever the server says. The caller
//     should do nothing more.
//   - 'failed': as 'fallback', but with `fallback: false`: nothing was started, and the
//     caller decides (an autosave that just shows "Not saved" and keeps its button).

export type FieldError = { field?: string; message: string }

export type Outcome<T> =
  | { kind: 'success'; status: number; data: T | null }
  | { kind: 'errors'; status: number; errors: FieldError[] }
  | { kind: 'fallback' }
  | { kind: 'failed'; status?: number; error?: unknown }

export type RequestOptions = {
  submitter?: HTMLElement | null // the button that submitted the form, as on SubmitEvent
  fallback?: boolean // default true: on failure, submit or navigate for real
  signal?: AbortSignal
}

const jsonType = /^application\/json\b/

// What the response means under the contract above, or undefined for "fall back".
async function interpret<T>(response: Response): Promise<Outcome<T> | undefined> {
  // fetch() follows redirects: JSON callers never get one, so one means something else
  // answered (a proxy's login page, say).
  if (response.redirected) {
    return undefined
  }
  if (response.status === 204 && response.ok) {
    return { kind: 'success', status: 204, data: null }
  }
  if (!jsonType.test(response.headers.get('Content-Type') ?? '')) {
    return undefined
  }
  const body: unknown = await response.json()
  if (response.ok) {
    return { kind: 'success', status: response.status, data: body as T }
  }
  if (response.status >= 400 && response.status < 500 && response.status !== 401) {
    const { errors, error, field } = (body ?? {}) as {
      errors?: FieldError[]
      error?: string
      field?: string
    }
    if (Array.isArray(errors)) {
      return { kind: 'errors', status: response.status, errors }
    }
    if (typeof error === 'string') {
      return { kind: 'errors', status: response.status, errors: [{ field, message: error }] }
    }
  }
  return undefined
}

// The form's own submission, minus any submit handler: form.submit() fires no submit
// event (so the enhancer's listener can't catch it again) and skips validation (which
// the browser already did before the event). It ignores the submitter, so its name and
// value go in as a hidden field, and its formaction/formmethod/... are honoured by
// setting them on the form.
function submitForReal(form: HTMLFormElement, submitter?: HTMLElement | null): void {
  if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
    if (submitter.name) {
      const field = document.createElement('input')
      field.type = 'hidden'
      field.name = submitter.name
      field.value = submitter.value
      form.append(field)
    }
    for (const attribute of ['action', 'method', 'enctype', 'target'] as const) {
      const value = submitter.getAttribute(`form${attribute}`)
      if (value !== null) {
        form.setAttribute(attribute, value)
      }
    }
  }
  HTMLFormElement.prototype.submit.call(form)
}

function formRequest(form: HTMLFormElement, submitter?: HTMLElement | null) {
  const button =
    submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
      ? submitter
      : null
  // The button's formaction/formmethod/formenctype if it has them, else the form's.
  const action = button?.hasAttribute('formaction') ? button.formAction : form.action
  const method = (
    button?.hasAttribute('formmethod') ? button.formMethod : form.method
  ).toUpperCase()
  const enctype = button?.hasAttribute('formenctype') ? button.formEnctype : form.enctype
  const data = new FormData(form, submitter)
  if (method === 'GET') {
    const url = new URL(action)
    url.search = new URLSearchParams(
      [...data].map(([key, value]) => [key, typeof value === 'string' ? value : value.name]),
    ).toString()
    return { url: url.href, init: { method } }
  }
  // The server parses url-encoded bodies (and multipart only where a file is uploaded),
  // so send what the browser would: FormData is always multipart.
  const body =
    enctype === 'multipart/form-data'
      ? data
      : new URLSearchParams(
          [...data].filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
  return { url: action, init: { method, body } }
}

// Sends `form` as the browser would have, asking for JSON. See the contract above.
export async function submitForm<T = unknown>(
  form: HTMLFormElement,
  { submitter, fallback = true, signal }: RequestOptions = {},
): Promise<Outcome<T>> {
  const { url, init } = formRequest(form, submitter)
  let status: number | undefined
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    })
    status = response.status
    const outcome = await interpret<T>(response)
    if (outcome) {
      return outcome
    }
  } catch (error) {
    // Aborted on purpose (the caller moved on): don't navigate either.
    if (signal?.aborted || !fallback) {
      return { kind: 'failed', error }
    }
    submitForReal(form, submitter)
    return { kind: 'fallback' }
  }
  if (!fallback) {
    return { kind: 'failed', status }
  }
  submitForReal(form, submitter)
  return { kind: 'fallback' }
}

// Gets a page's data as JSON (the same URL, `Accept: application/json`). On failure, goes
// to the page for real (location.assign), or with `fallback: false` returns 'failed'.
export async function followLink<T = unknown>(
  link: HTMLAnchorElement | string,
  { fallback = true, signal }: Omit<RequestOptions, 'submitter'> = {},
): Promise<Outcome<T>> {
  const href = typeof link === 'string' ? new URL(link, document.baseURI).href : link.href
  let status: number | undefined
  try {
    const response = await fetch(href, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    })
    status = response.status
    const outcome = await interpret<T>(response)
    if (outcome?.kind === 'success') {
      return outcome
    }
  } catch (error) {
    if (signal?.aborted || !fallback) {
      return { kind: 'failed', error }
    }
    location.assign(href)
    return { kind: 'fallback' }
  }
  // A GET with an error status is a page too (404, 429): show it as the browser would.
  if (!fallback) {
    return { kind: 'failed', status }
  }
  location.assign(href)
  return { kind: 'fallback' }
}
