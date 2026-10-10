import { h } from 'preact'
import htm from 'htm'
import { renderToString } from 'preact-render-to-string'
import type { Blurt, FeedItem, UserProfile } from '../routes/state.ts'

const html = htm.bind(h)

// Only http(s) links are ever rendered as hrefs; anything else (e.g. javascript:) is plain text.
export function isWebUrl(value: string): boolean {
  const url = URL.parse(value)
  return url?.protocol === 'http:' || url?.protocol === 'https:'
}

type PageProps = {
  blurts: FeedItem[]
  composer?: ComposerProps
  isAuthenticated?: boolean
}

type ComposerProps = {
  text?: string
  validationError?: string
  parentId?: number
  label?: string
  button?: string
}

type CreateUserProps = {
  username?: string
  validationError?: string
}

type LoginProps = CreateUserProps

type ProfilePageProps = {
  blurts: Blurt[]
  profile: UserProfile
  canEdit: boolean
}

type ProfileEditProps = {
  profile: UserProfile
  validationError?: string
}

function Composer({
  text = '',
  validationError,
  parentId,
  label = 'Blurt',
  button = 'Blurt it',
}: ComposerProps) {
  return html`
    <form method="post" action="/api/blurts">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      ${parentId !== undefined && html`<input type="hidden" name="parentId" value=${parentId} />`}
      <label>${label} <textarea name="text" maxlength="280" required>${text}</textarea></label>
      <button type="submit">${button}</button>
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
    <form method="post" action="/api/logout">
      <button type="submit">Log out</button>
    </form>
  `
}

function blurtUrl(blurt: Blurt): string {
  return `/${blurt.username}/${blurt.id}`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? 'y' : 'ies'}`
}

// `replies` are shown inline (the feed); the link below covers the rest of the thread.
function BlurtCard({
  blurt,
  replies = [],
  showActions = true,
}: {
  blurt: Blurt
  replies?: Blurt[]
  showActions?: boolean
}) {
  const hiddenReplies = blurt.replyCount - replies.length
  const threadLink =
    hiddenReplies <= 0
      ? 'Reply'
      : replies.length > 0
        ? plural(hiddenReplies, 'more repl')
        : plural(hiddenReplies, 'repl')

  return html`
    <article class="blurt">
      <div class="blurt-meta">
        <strong><a href="/${blurt.username}/">${blurt.username}</a></strong>
        <a href=${blurtUrl(blurt)}
          ><time datetime=${blurt.createdAt.toISOString()}
            >${blurt.createdAt.toLocaleString()}</time
          ></a
        >
      </div>
      <p>${blurt.text}</p>
      ${
        replies.length > 0 &&
        html`<div class="replies">
          ${replies.map((reply) => html`<${BlurtCard} blurt=${reply} />`)}
        </div>`
      }
      ${
        showActions &&
        html`<p class="blurt-actions"><a href=${blurtUrl(blurt)}>${threadLink}</a></p>`
      }
    </article>
  `
}

type BlurtPageProps = {
  blurt: Blurt
  parent?: Blurt
  replies: Blurt[]
  related: Blurt[]
  composer?: ComposerProps
  isAuthenticated: boolean
}

function BlurtPage({ blurt, parent, replies, related, composer, isAuthenticated }: BlurtPageProps) {
  return html`
    <header>
      <h1>${blurt.username}</h1>
      <p class="tagline"><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      ${
        parent &&
        html`<section aria-label="In reply to">
          <h2>In reply to</h2>
          <${BlurtCard} blurt=${parent} />
        </section>`
      }
      <${BlurtCard} blurt=${blurt} showActions=${false} />
      <section aria-label="Replies">
        <h2>Replies</h2>
        ${
          isAuthenticated
            ? html`<${Composer}
                ...${composer ?? {}}
                parentId=${blurt.id}
                label="Reply"
                button="Reply"
              />`
            : html`<${AnonymousActions} />`
        }
        ${
          replies.length > 0
            ? replies.map((reply) => html`<${BlurtCard} blurt=${reply} />`)
            : html`<p class="empty">No replies yet.</p>`
        }
      </section>
      <section aria-label="Related blurts">
        <h2>Related blurts</h2>
        ${
          related.length > 0
            ? related.map((other) => html`<${BlurtCard} blurt=${other} />`)
            : html`<p class="empty">Nothing related yet.</p>`
        }
      </section>
    </main>
  `
}

function renderSocial(value: string): unknown {
  if (!value) {
    return html`<span class="empty">Not set</span>`
  }

  if (isWebUrl(value)) {
    return html`<a href=${value}>${value}</a>`
  }

  return html`<span>${value}</span>`
}

function ProfileData({ profile, canEdit }: { profile: UserProfile; canEdit: boolean }) {
  return html`
    <section aria-label="Profile">
      <div class="section-title">
        <h2>Profile</h2>
        ${
          canEdit &&
          html`<a class="button-link" href="/${profile.username}/edit" aria-label="Edit profile"
            >Edit profile</a
          >`
        }
      </div>
      <dl class="profile-data">
        <dt>Homepage</dt>
        <dd>${renderSocial(profile.homepage)}</dd>
        <dt>X</dt>
        <dd>${renderSocial(profile.x)}</dd>
        <dt>Instagram</dt>
        <dd>${renderSocial(profile.instagram)}</dd>
        <dt>TikTok</dt>
        <dd>${renderSocial(profile.tiktok)}</dd>
        <dt>YouTube</dt>
        <dd>${renderSocial(profile.youtube)}</dd>
        <dt>GitHub</dt>
        <dd>${renderSocial(profile.github)}</dd>
        <dt>LinkedIn</dt>
        <dd>${renderSocial(profile.linkedin)}</dd>
        <dt>Bio</dt>
        <dd>${profile.bio || html`<span class="empty">Not set</span>`}</dd>
      </dl>
    </section>
  `
}

function ProfileEditForm({ profile, validationError }: ProfileEditProps) {
  return html`
    <header>
      <h1>Edit profile: ${profile.username}</h1>
      <p><a href="/${profile.username}/">Back to profile</a></p>
    </header>
    <main>
      <form method="post" action="/${profile.username}/edit">
        ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
        <label
          >Homepage
          <input
            name="homepage"
            maxlength="200"
            value=${profile.homepage}
            placeholder="https://example.com"
          />
        </label>
        <label
          >X
          <input name="x" maxlength="200" value=${profile.x} placeholder="@handle or full URL" />
        </label>
        <label
          >Instagram
          <input
            name="instagram"
            maxlength="200"
            value=${profile.instagram}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >TikTok
          <input
            name="tiktok"
            maxlength="200"
            value=${profile.tiktok}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >YouTube
          <input
            name="youtube"
            maxlength="200"
            value=${profile.youtube}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >GitHub
          <input
            name="github"
            maxlength="200"
            value=${profile.github}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >LinkedIn
          <input
            name="linkedin"
            maxlength="200"
            value=${profile.linkedin}
            placeholder="@handle or full URL"
          />
        </label>
        <label
          >Bio
          <textarea name="bio" maxlength="4000" placeholder="Say the thing.">
${profile.bio}</textarea>
        </label>
        <button type="submit">Save profile</button>
      </form>
    </main>
  `
}

function FeedPage({ blurts, composer, isAuthenticated = false }: PageProps) {
  const feed = blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} replies=${blurt.replies} />`)

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

function ProfilePage({ blurts, profile, canEdit }: ProfilePageProps) {
  const feed = blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} />`)

  return html`
    <header>
      <h1>${profile.username}</h1>
      <p class="tagline"><a href="/">Back to blurt.trade</a></p>
    </header>
    <main>
      <${ProfileData} profile=${profile} canEdit=${canEdit} />
      <section aria-label="${profile.username} blurts">
        <h2>Blurts</h2>
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
          .button-link {
            display: inline-block;
            border: 1px solid #aaa095;
            background: #201d1a;
            color: #fffdf8;
            text-decoration: none;
            padding: 0.45rem 0.8rem;
          }
          .section-title {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.6rem;
          }
          .section-title h2 {
            margin: 0;
          }
          .profile-data {
            border: 1px solid #cfc5b8;
            background: #fffdf8;
            margin: 0 0 1rem;
            padding: 1rem;
          }
          .profile-data dt {
            font-weight: bold;
            margin-top: 0.7rem;
          }
          .profile-data dt:first-child {
            margin-top: 0;
          }
          .profile-data dd {
            margin: 0.2rem 0 0;
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
          .replies {
            margin-left: 1rem;
            padding-left: 0.75rem;
            border-left: 3px solid #cfc5b8;
          }
          .replies .blurt {
            padding: 0.6rem;
          }
          .blurt-actions {
            margin: 0.5rem 0 0;
            font-size: 0.85rem;
          }
          section h2 {
            margin-top: 2rem;
          }
        </style>
      </head>
      <body>
        ${children}
      </body>
    </html>`
}

export function renderFeedPage(
  blurts: FeedItem[],
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

export function renderBlurtPage(props: BlurtPageProps): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(BlurtPage, props) }))
}

export function renderProfilePage(props: ProfilePageProps): string {
  return '<!doctype html>' + renderToString(h(IndexDocument, { children: h(ProfilePage, props) }))
}

export function renderProfileEditPage(props: ProfileEditProps): string {
  return (
    '<!doctype html>' + renderToString(h(IndexDocument, { children: h(ProfileEditForm, props) }))
  )
}
