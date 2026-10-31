import type { Request, Response } from 'express'
import type { ZodError } from 'zod'
import type { Markdown } from './templates/markdown.ts'
import { renderErrorPage } from './templates/layout.ts'
import { pictureMode, pictureReplacer } from './picture-json.ts'

// One path per resource; the Accept header picks the representation. HTML comes first so
// browsers and `*/*` (fetch's default) get the page. See docs/routes.md.
const representations = ['html', 'json', 'text/markdown', 'text/plain']

// Never serialized, whatever a route hands over. Types keep these out already; this is
// the second lock.
const sensitiveKeys = new Set(['passwordHash', 'password', 'embedding'])

export function toJson(
  data: unknown,
  replace?: (holder: unknown, key: string, value: unknown) => unknown,
): string {
  return JSON.stringify(data, function (this: unknown, key: string, value: unknown) {
    if (sensitiveKeys.has(key)) {
      return undefined
    }
    return replace ? replace(this, key, value) : value
  })
}

export type Views<T> = {
  html: (data: T) => string
  markdown: (data: T) => Markdown
}

// Sends the data a route fetched once, rendered as the client asked: HTML, the data
// itself as JSON, or Markdown (for text/markdown and text/plain). In JSON, blurts' pictures
// come with their drawing as base64 (see src/picture-json.ts, and `?pictures=`).
export async function represent<T>(
  request: Request,
  response: Response,
  data: T,
  views: Views<T>,
  status = 200,
): Promise<void> {
  response.vary('Accept').status(status)
  const representation = request.accepts(representations)
  if (representation === 'html') {
    // Tells crawlers and agents the same URL has a Markdown version (see /llms.txt).
    if (!/[<>"\s]/.test(request.originalUrl)) {
      response.set('Link', `<${request.originalUrl}>; rel="alternate"; type="text/markdown"`)
    }
    response.type('html').send(views.html(data))
  } else if (representation === 'json') {
    response.type('json').send(toJson(data, await pictureReplacer(data, pictureMode(request))))
  } else if (representation) {
    response.type(representation).send(`${views.markdown(data)}\n`)
  } else {
    response.status(406).type('text').send('Not Acceptable')
  }
}

// fetch() callers that want JSON back instead of a page or a redirect.
export function wantsJson(request: Request): boolean {
  return request.accepts(['html', 'json']) === 'json'
}

export function sendError(
  request: Request,
  response: Response,
  status: number,
  message: string,
  field?: string, // the query parameter a 400 is about, if any
): void {
  response.vary('Accept').status(status)
  if (wantsJson(request)) {
    response.type('json').send(toJson({ error: message, field }))
  } else if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    request.accepts(['html', 'text/plain', 'text/markdown']) === 'html'
  ) {
    response.type('html').send(renderErrorPage({ status, message }))
  } else {
    response.type('text').send(message)
  }
}

export type FieldError = { field?: string; message: string }

export function fieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) =>
    issue.path.length > 0
      ? { field: issue.path.join('.'), message: issue.message }
      : { message: issue.message },
  )
}

// A failed form POST: 400 (or `status`) with the errors as JSON, or the form page
// re-rendered with them.
export async function sendFormErrors(
  request: Request,
  response: Response,
  errors: FieldError[],
  renderPage: (message: string) => string | Promise<string>,
  status = 400,
): Promise<void> {
  response.vary('Accept').status(status)
  if (wantsJson(request)) {
    response.type('json').send(toJson({ errors }))
  } else {
    const message = errors.map((error) => error.message).join(' ')
    response.type('html').send(await renderPage(message))
  }
}

// A successful POST: forms get a 303 to `redirect`. JSON callers get `data` with `status`
// (and `location` as the Location header, for a 201), or 204 when there is no data.
export function sendFormSuccess(
  request: Request,
  response: Response,
  outcome: { redirect: string; data?: unknown; status?: number; location?: string },
): void {
  if (!wantsJson(request)) {
    response.redirect(303, outcome.redirect)
    return
  }
  response.vary('Accept')
  if (outcome.data === undefined) {
    response.status(204).end()
    return
  }
  if (outcome.location) {
    response.location(outcome.location)
  }
  response
    .status(outcome.status ?? 200)
    .type('json')
    .send(toJson(outcome.data))
}
