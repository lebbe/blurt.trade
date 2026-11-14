import { h } from 'preact'
import { accountDeletionEffects, type DeleteAccountData, type SettingsData } from './data.ts'
import {
  ButtonLink,
  type FormProps,
  JavaScriptSetting,
  SupportLinks,
} from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { passwordMaxLength } from '../../shared/limits.ts'
import { SubmitButton } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { plural } from '../../ui/text.ts'

function SettingsPage({ viewer, activeSessions }: SettingsData) {
  const edit = `/${viewer.username}/edit`
  return html`
    <${Page}
      title="Settings"
      tagline=${`Account and safety controls for ${viewer.username}, all in plain sight.`}
      aside=${html`<${SupportLinks} />`}
    >
      <section class="panel" aria-label="Sessions">
        <h2>Sessions</h2>
        <p>
          You're logged in on ${plural(activeSessions, 'browser or device', 'browsers or devices')}.
        </p>
        <p class="tiny">
          Lost a phone, or logged in somewhere you shouldn't have? Log out everywhere, this browser
          included. Other devices are logged out within 5 minutes.
        </p>
        <div class="actions">
          <form method="post" action="/api/logout" class="inline">
            <${SubmitButton} icon="logout" label="Log out" kind="secondary" />
          </form>
          <form method="post" action="/api/logout-everywhere" class="inline">
            <${SubmitButton} icon="shield" label="Log out everywhere" />
          </form>
        </div>
      </section>
      <section class="panel" aria-label="Profile and appearance">
        <h2>Profile and appearance</h2>
        <div class="actions">
          <${ButtonLink} href=${edit} icon="edit" label="Edit profile" />
          <${ButtonLink} href=${`${edit}#avatar`} icon="person" label="Avatar" />
          <${ButtonLink} href=${`${edit}#location`} icon="pin" label="Location" />
          <${ButtonLink} href=${`${edit}#theme`} icon="palette" label="Theme" />
        </div>
      </section>
      <section class="panel" id="javascript" aria-label="JavaScript">
        <h2>JavaScript</h2>
        <${JavaScriptSetting} />
      </section>
      <section class="panel" aria-label="Delete account">
        <h2 class="warn">Delete account</h2>
        <p>Deletes your profile and your blurts for good. You'll be asked for your password.</p>
        <${ButtonLink}
          href="/settings/delete"
          icon="warning"
          label="Delete my account"
          kind="danger"
        />
      </section>
    <//>
  `
}

function DeleteAccountPage({ viewer, inviteOnly, validationError }: DeleteAccountData & FormProps) {
  return html`
    <${Page}
      title=${`Delete account: ${viewer.username}`}
      tagline="For good. There is no undo."
      actions=${html`<${ButtonLink} href="/settings" icon="back" label="Back to settings" />`}
    >
      <section class="panel">
        <h2 class="warn">What happens</h2>
        <ul>
          ${accountDeletionEffects(inviteOnly).map((effect) => html`<li>${effect}</li>`)}
        </ul>
        <form method="post" action="/settings/delete">
          ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
          <label
            >Your password, to confirm
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              maxlength=${passwordMaxLength}
              required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="warning" label="Delete my account for good" kind="danger" />
          </div>
        </form>
      </section>
    <//>
  `
}

export function renderSettingsPage(data: SettingsData): string {
  return renderDocument(h(SettingsPage, data), { title: 'Settings', noindex: true })
}

export function renderDeleteAccountPage(data: DeleteAccountData, validationError?: string): string {
  return renderDocument(h(DeleteAccountPage, { ...data, validationError }), {
    title: 'Delete account',
    noindex: true,
  })
}
