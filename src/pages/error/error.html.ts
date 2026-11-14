import { h } from 'preact'
import { Page, renderDocument } from '../shared/layout.ts'
import { html } from '../../ui/html.ts'
import { Icon } from '../../ui/icons.ts'

// The page for an error status. Imports nothing route-specific, so error handlers
// (src/negotiate.ts, src/logging.ts) can render it without importing the routes.

const errorTitles: Record<number, string> = {
  400: 'Bad request',
  401: 'Log in first',
  403: 'Not allowed',
  404: 'Not found',
  406: 'Not acceptable',
  409: 'Conflict',
  413: 'Too large',
  429: 'Too many requests',
  500: 'Something went wrong',
}

export type ErrorPageData = { status: number; message: string; requestId?: string }

function ErrorPage({ status, message, requestId }: ErrorPageData) {
  const title = errorTitles[status] ?? (status >= 500 ? errorTitles[500] : 'Error')
  return html`
    <${Page} title=${title} tagline=${`Error ${status}`}>
      <section class="panel error-page">
        <p>${message}</p>
        ${requestId && html`<p class="tiny">Request id: <code>${requestId}</code></p>`}
        <div class="actions">
          <a class="button secondary" href="/"
            ><${Icon} name="back" /><span>Back to blurt.trade</span></a
          >
          ${
            status === 401 &&
            html`<a class="button" href="/login"><${Icon} name="login" /><span>Log in</span></a>`
          }
        </div>
      </section>
    <//>
  `
}

// The styled page for an error status. `message` must be safe to show: for a 500 it is
// the generic one, never the error itself.
export function renderErrorPage(data: ErrorPageData): string {
  const title = errorTitles[data.status] ?? 'Error'
  return renderDocument(h(ErrorPage, data), { title, noindex: true })
}
