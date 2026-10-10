import { h } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import type { Blurt } from '../routes/state.ts'

const html = htm.bind(h)

type PageProps = {
  blurts: Blurt[]
  composer?: ComposerProps
  isAuthenticated?: boolean
}

type ComposerProps = {
  text?: string
  validationError?: string
}

type CreateUserProps = {
  username?: string
  validationError?: string
}

type LoginProps = CreateUserProps

function Composer({ text = '', validationError }: ComposerProps) {
  return html`
    <form method="post" action="/blurts">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label>Blurt <textarea name="text" maxlength="280" required>${text}</textarea></label>
      <button type="submit">Blurt it</button>
    </form>
  `
}

function CreateUserForm({ username = '', validationError }: CreateUserProps) {
  return html`
    <form method="post" action="/createUser">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label>Username <input name="username" maxlength="40" required value=${username} /></label>
      <label
        >Password <input name="password" type="password" minlength="8" maxlength="200" required
      /></label>
      <button type="submit">Create user</button>
    </form>
  `
}

function AnonymousActions() {
  return html`
    <p>
      <a href="/login">Log in</a>
      or
      <a href="/createUser">create a profile</a>
      to blurt.
    </p>
  `
}

function LoginForm({ username = '', validationError }: LoginProps) {
  return html`
    <form method="post" action="/login">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label>Username <input name="username" maxlength="40" required value=${username} /></label>
      <label>Password <input name="password" type="password" maxlength="200" required /></label>
      <button type="submit">Log in</button>
    </form>
  `
}

function LogoutForm() {
  return html`
    <form method="get" action="/logout">
      <button type="submit">Log out</button>
    </form>
  `
}

function BlurtCard({ blurt }: { blurt: Blurt }) {
  return html`
    <article class="blurt">
      <div class="blurt-meta">
        <strong>${blurt.username}</strong>
        <time datetime=${blurt.createdAt.toISOString()}>${blurt.createdAt.toLocaleString()}</time>
      </div>
      <p>${blurt.text}</p>
    </article>
  `
}

function FeedPage({ blurts, composer, isAuthenticated = false }: PageProps) {
  const feed = blurts
    .slice()
    .reverse()
    .map((blurt) => html`<${BlurtCard} blurt=${blurt} />`)

  return html`
    <header>
      <h1>blurt.trade</h1>
      <p class="tagline">Say the thing. Regret it later.</p>
    </header>
    <main>
      ${isAuthenticated ? html`<${Composer} ...${composer ?? {}} />` : html`<${AnonymousActions} />`}
      ${isAuthenticated && html`<${LogoutForm} />`}
      <section aria-label="Blurts">
        ${feed.length > 0 ? feed : html`<p class="empty">Nothing has been blurted yet.</p>`}
      </section>
    </main>
  `
}

function IndexDocument({ children }: { children: unknown }) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>blurt.trade</title>
        <style>
          :root {
            color-scheme: light;
            font-family: Georgia, serif;
            background: #f4f0e8;
            color: #201d1a;
          }
          body {
            max-width: 42rem;
            margin: 0 auto;
            padding: 2rem 1rem;
          }
          h1 {
            margin: 0 0 0.25rem;
            font-size: 2.5rem;
          }
          .tagline {
            margin: 0 0 2rem;
            color: #6d6258;
          }
          form,
          .blurt {
            border: 1px solid #cfc5b8;
            background: #fffdf8;
            padding: 1rem;
          }
          form {
            display: grid;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
          }
          .validation-error {
            margin: 0;
            color: #a32020;
            font-weight: bold;
          }
          label {
            display: grid;
            gap: 0.3rem;
            font-size: 0.9rem;
          }
          input,
          textarea,
          button {
            font: inherit;
            padding: 0.65rem;
            border: 1px solid #aaa095;
          }
          textarea {
            min-height: 5rem;
            resize: vertical;
          }
          button {
            background: #201d1a;
            color: #fffdf8;
            cursor: pointer;
          }
          .blurt {
            margin-top: 0.75rem;
          }
          .blurt-meta {
            display: flex;
            justify-content: space-between;
            gap: 1rem;
          }
          time {
            color: #6d6258;
            font-size: 0.85rem;
          }
          .empty {
            color: #6d6258;
          }
        </style>
      </head>
      <body>
        ${children}
      </body>
    </html>`
}

export function renderFeedPage(
  blurts: Blurt[],
  composer?: ComposerProps,
  isAuthenticated = false,
): string {
  return (
    '<!doctype html>' +
    renderToString(
      h(IndexDocument, { children: h(FeedPage, { blurts, composer, isAuthenticated }) }),
    )
  )
}

export function renderLoginPage(props: LoginProps = {}): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(LoginForm, props) }))
}

export function renderCreateUserPage(props: CreateUserProps = {}): string {
  return (
    '<!doctype html>' + renderToString(h(IndexDocument, { children: h(CreateUserForm, props) }))
  )
}
