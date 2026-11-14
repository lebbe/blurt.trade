import { h } from 'preact'
import type { ProfileEditData } from './data.ts'
import { CardForm, LocationForms, NotificationsForm, ThemeForm } from './forms.ts'
import { socialFields } from '../profile/profile.html.ts'
import { ButtonLink, LinkPanel } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { bioMaxLength, linkMaxLength } from '../../shared/limits.ts'
import { SubmitButton } from '../../ui/forms.ts'
import { ProfilePictureForm } from '../../ui/profile-picture.ts'
import { AvatarForm } from '../../ui/avatar-form.ts'
import { html } from '../../ui/html.ts'

// The edit page: the profile form, then the forms in forms.ts. With JavaScript,
// src/client/autosave.ts, map.ts and mouth.ts enhance them (`data-enhance`, see
// src/client/main.ts).

type ProfileEditProps = ProfileEditData & {
  validationError?: string
  locationError?: string
  avatarError?: string
  pictureError?: string
}

function ProfileEditForm({
  profile,
  location,
  notifications,
  push,
  validationError,
  locationError,
  avatarError,
  pictureError,
}: ProfileEditProps) {
  const aside = html`
    <${LinkPanel}
      title="On this page"
      links=${[
        ['#profile', 'Profile and links'],
        ['#card', 'Share card'],
        ...(profile.avatar.photo
          ? [['#picture', 'Profile picture'] as [string, string]]
          : [
              ['#avatar', 'Avatar'] as [string, string],
              ['#picture', 'Profile picture'] as [string, string],
            ]),
        ['#location', 'Location and time'],
        ['#theme', 'Theme'],
        ['#notifications', 'Notifications'],
      ]}
    />
    <${LinkPanel}
      title="Elsewhere"
      links=${[
        [`/${profile.username}/`, 'Your profile'],
        ['/settings', 'Account settings'],
      ]}
    />
  `
  return html`
    <${Page}
      title=${`Edit profile: ${profile.username}`}
      tagline="Identity, looks, whereabouts and colours."
      actions=${html`<${ButtonLink}
        href=${`/${profile.username}/`}
        icon="back"
        label="Back to profile"
      />`}
      aside=${aside}
    >
      <section class="panel" aria-label="Profile" id="profile">
        <h2>Profile</h2>
        <form
          method="post"
          action="/${profile.username}/edit"
          id="profile-form"
          data-enhance="autosave"
        >
          ${validationError && html`<p class="validation-error" role="alert">${validationError}</p>`}
          <label
            >Bio
            <textarea name="bio" maxlength=${bioMaxLength} placeholder="Say the thing.">
${profile.bio}</textarea>
          </label>
          <div class="field-grid">
            <label
              >Homepage
              <input
                name="homepage"
                maxlength=${linkMaxLength}
                value=${profile.homepage}
                placeholder="https://example.com"
              />
            </label>
            ${socialFields
              .filter(([key]) => key !== 'homepage')
              .map(
                ([key, label]) =>
                  html`<label
                    >${label}
                    <input
                      name=${key}
                      maxlength=${linkMaxLength}
                      value=${profile[key]}
                      placeholder="@handle or full URL"
                    />
                  </label>`,
              )}
          </div>
          <div class="actions"><${SubmitButton} icon="save" label="Save profile" /></div>
        </form>
      </section>
      <${CardForm} profile=${profile} />
      ${
        // With a profile picture the cartoon is never shown, so neither are its settings:
        // the picture's panel (where its mouth is) takes their place, and #avatar links there.
        profile.avatar.photo
          ? html`<span id="avatar"></span>`
          : html`<${AvatarForm} avatar=${profile.avatar} error=${avatarError} />`
      }
      <${ProfilePictureForm} avatar=${profile.avatar} error=${pictureError} />
      <${LocationForms} location=${location} error=${locationError} />
      <${ThemeForm} />
      <${NotificationsForm} settings=${notifications} push=${push} />
    <//>
  `
}

export function renderProfileEditPage(props: ProfileEditProps): string {
  return renderDocument(h(ProfileEditForm, props), {
    title: `Edit profile: ${props.profile.username}`,
  })
}
