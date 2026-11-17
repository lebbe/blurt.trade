import { h } from 'preact'
import { forgotPassword, noPasswordReset, type SignupPageData, type WaitlistData } from './data.ts'
import { ButtonLink, type FormProps, InviteFriends, SupportLinks } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { passwordMaxLength, passwordMinLength, usernameMaxLength } from '../../shared/limits.ts'
import { SubmitButton, ValidationError } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { plural } from '../../ui/text.ts'

type CreateUserProps = SignupPageData & FormProps

type LoginProps = FormProps

// The sign-up page in each state. Open sign-up takes an invite code too, optionally, so
// "invited by" still shows on the profile.
function CreateUserPage({
  viewer,
  signup,
  inviteCode,
  username,
  validationError,
}: CreateUserProps) {
  // Nothing to sign up for when you're logged in: invite your friends instead.
  if (viewer) {
    return html`
      <${Page} title="Invite your friends" tagline="You already have a profile.">
        <${InviteFriends} />
      <//>
    `
  }
  const form = html`<${CreateUserForm}
    username=${username}
    inviteCode=${inviteCode ?? ''}
    inviteRequired=${signup === 'invite'}
    validationError=${validationError}
  />`
  const aside = html`
    <section class="panel">
      <h2>Already here?</h2>
      <p>Welcome back.</p>
      <${ButtonLink} href="/login" icon="login" label="Log in" />
    </section>
    <${SupportLinks} />
  `
  if (signup === 'open') {
    return html`
      <${Page}
        title="Create a profile"
        tagline="Pick a name. Blurt within a minute."
        aside=${aside}
      >
        <section class="panel">${form}</section>
      <//>
    `
  }
  if (signup === 'invite') {
    return html`
      <${Page} title="Create a profile" tagline="Invite only, for now." aside=${aside}>
        <section class="panel signup-closed" aria-label="Invite only">
          <h2>Invite only</h2>
          <p>
            blurt.trade is invite-only right now. You need an invite code from someone who's already
            here to sign up.
          </p>
          ${form}
          <p>Already have a profile? <a href="/login">Log in</a>.</p>
        </section>
      <//>
    `
  }
  return html`
    <${Page} title="Create a profile" tagline="We're full right now." aside=${aside}>
      <section class="panel signup-closed" aria-label="Waitlist">
        <h2>Sign-up is full</h2>
        <p>
          blurt.trade isn't taking new profiles right now. Leave the username you'd like and check
          back on the <a href="/waitlist">waitlist page</a>: it says when sign-up opens again.
        </p>
        <${WaitlistForm} username=${username} validationError=${validationError} />
        <p>Already have a profile? <a href="/login">Log in</a>.</p>
      </section>
    <//>
  `
}

// Only a username: no email, so we never store anything personal or contact anyone.
function WaitlistForm({ username = '', validationError }: FormProps) {
  return html`
    <form method="post" action="/waitlist">
      <${ValidationError} message=${validationError} />
      <label
        >Username <input name="username" maxlength=${usernameMaxLength} required value=${username}
      /></label>
      <div class="actions"><${SubmitButton} icon="hourglass" label="Join the waitlist" /></div>
    </form>
  `
}

function WaitlistPage({
  signup,
  waiting,
  username: lookedUp,
  entry,
  form,
}: WaitlistData & { form?: FormProps }) {
  const status = entry
    ? entry.status === 'joined'
      ? html`<p><a href="/${entry.username}/">${entry.username}</a> has signed up.</p>`
      : html`<p>${entry.username} is on the waitlist.</p>`
    : lookedUp && html`<p>${lookedUp} isn't on the waitlist.</p>`
  const opening =
    signup === 'open'
      ? html`<p>Sign-up is open again: <a href="/signup">create your profile</a>.</p>`
      : signup === 'invite'
        ? html`<p>Sign-up has reopened, with an invite code: <a href="/signup">sign up</a>.</p>`
        : html`<p>Sign-up is full. When it opens again, this page will say so.</p>`
  return html`
    <${Page}
      title="Waitlist"
      tagline=${plural(waiting, 'person', 'people') + ' waiting.'}
      aside=${html`<${SupportLinks} />`}
    >
      <section class="panel">
        ${status} ${opening}
        <p class="tiny">${plural(waiting, 'person', 'people')} waiting.</p>
      </section>
      ${
        signup === 'waitlist' &&
        html`<section class="panel">
          <h2>Join the waitlist</h2>
          <${WaitlistForm} ...${form ?? {}} />
          <p class="hint">
            We don't take an email address, so we can't tell you when you're in. Bookmark this page
            after joining and check back.
          </p>
        </section>`
      }
    <//>
  `
}

function CreateUserForm({
  username = '',
  inviteCode = '',
  inviteRequired = false,
  validationError,
}: FormProps & { inviteCode?: string; inviteRequired?: boolean }) {
  return html`
    <form method="post" action="/signup">
      ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
      <label
        >Username <input name="username" maxlength=${usernameMaxLength} required value=${username}
      /></label>
      <label
        >Password
        <input
          name="password"
          type="password"
          autocomplete="new-password"
          minlength=${passwordMinLength}
          maxlength=${passwordMaxLength}
          required
      /></label>
      <label
        >Repeat password
        <input
          name="passwordConfirm"
          type="password"
          autocomplete="new-password"
          maxlength=${passwordMaxLength}
      /></label>
      <label class="check"
        ><input type="checkbox" name="skipConfirm" value="1" /> Skip repeating the password</label
      >
      <label class="check"
        ><input type="checkbox" name="remember" value="1" /> Keep me logged in</label
      >
      <p class="hint password-hint">${noPasswordReset}</p>
      ${
        inviteRequired
          ? html`<label
              >Invite code
              <input
                name="inviteCode"
                maxlength=${usernameMaxLength}
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                required
                value=${inviteCode}
            /></label>`
          : inviteCode && html`<input type="hidden" name="inviteCode" value=${inviteCode} />`
      }
      <div class="actions"><${SubmitButton} icon="personPlus" label="Create user" /></div>
    </form>
  `
}

function LoginPage({ username = '', validationError }: LoginProps) {
  return html`
    <${Page}
      title="Log in"
      tagline="Back for more blurting."
      aside=${html`
        <section class="panel">
          <h2>New here?</h2>
          <p>A username and a password is all it takes. No email, no phone number.</p>
          <${ButtonLink} href="/signup" icon="personPlus" label="Create a profile" />
        </section>
        <${SupportLinks} />
      `}
    >
      <section class="panel">
        <form method="post" action="/login">
          ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
          <label
            >Username
            <input name="username" maxlength=${usernameMaxLength} required value=${username}
          /></label>
          <label
            >Password
            <input name="password" type="password" maxlength=${passwordMaxLength} required
          /></label>
          <label class="check"
            ><input type="checkbox" name="remember" value="1" /> Keep me logged in</label
          >
          <div class="actions"><${SubmitButton} icon="login" label="Log in" /></div>
          <p class="hint">${forgotPassword} <a href="/privacy">Privacy</a>.</p>
        </form>
      </section>
    <//>
  `
}

export function renderLoginPage(props: LoginProps = {}): string {
  return renderDocument(h(LoginPage, props), { title: 'Log in', noindex: true })
}

export function renderCreateUserPage(props: CreateUserProps): string {
  return renderDocument(h(CreateUserPage, props), { title: 'Create a profile', noindex: true })
}

export function renderWaitlistPage(data: WaitlistData, form?: FormProps): string {
  return renderDocument(h(WaitlistPage, { ...data, form }), { title: 'Waitlist', noindex: true })
}
