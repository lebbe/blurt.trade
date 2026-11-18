import { h } from 'preact'
import { ogHash, ogProfileImagePath, profileCardText } from '../../og.ts'
import type { ProfilePageData } from './data.ts'
import { ButtonLink, InviteFriends, NextPageLink } from '../shared/components.ts'
import { Page, type PageMeta, renderDocument, shareTitleMax } from '../shared/layout.ts'
import type { UserProfile } from '../../routes/state/profiles.ts'
import type { InviteCode } from '../../routes/state/signup.ts'
import { isWebUrl, normalizedWebUrl } from '../../shared/limits.ts'
import { AvatarView } from '../../ui/avatar.ts'
import { BlurtCard } from '../../ui/blurt-card.ts'
import { FollowForm, followTagline } from '../../ui/follow.ts'
import { html } from '../../ui/html.ts'
import { Icon } from '../../ui/icons.ts'
import { preview } from '../../ui/text.ts'
import { olderBlurtsUrl } from '../../ui/urls.ts'

// Without JavaScript a plain link to the share card image. With it (src/client/share.ts)
// the browser's own share sheet on phones, else a popup of share links, for the profile's
// page; like a blurt's Share (ShareAction in src/ui/blurt-card.ts).
function ShareLink({ href, username }: { href: string; username: string }) {
  return html`<a
    class="button secondary"
    href=${href}
    data-enhance="share"
    data-share-url="/${username}/"
    data-share-title=${preview(`${username} on blurt.trade`, shareTitleMax)}
    ><${Icon} name="share" /><span>Share</span></a
  >`
}

function renderSocial(value: string): unknown {
  if (isWebUrl(value)) {
    const url = normalizedWebUrl(value) ?? value
    return html`<a href=${url} rel="noreferrer noopener nofollow ugc" referrerpolicy="no-referrer"
      >${url}</a
    >`
  }

  return html`<span>${value}</span>`
}

export const socialFields = [
  ['homepage', 'Homepage'],
  ['x', 'X'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['github', 'GitHub'],
  ['linkedin', 'LinkedIn'],
] as const

// Only the links that are set; no panel at all when none are.
function ProfileLinks({ profile }: { profile: UserProfile }) {
  const set = socialFields.filter(([key]) => profile[key])
  if (set.length === 0) {
    return null
  }
  return html`
    <section class="panel" aria-label="Links">
      <h2>Links</h2>
      <dl class="profile-data">
        ${set.map(
          ([key, label]) =>
            html`<dt>${label}</dt>
              <dd>${renderSocial(profile[key])}</dd>`,
        )}
      </dl>
    </section>
  `
}

// Unused codes link to sign-up with the code filled in, ready to share. The route only
// sends them while sign-up needs an invite code.
function InviteCodes({ codes }: { codes: InviteCode[] }) {
  const now = new Date()
  const items = codes.map((invite) => {
    const status = invite.usedAt
      ? invite.usedBy
        ? html`used by <a href="/${invite.usedBy}/">${invite.usedBy}</a>`
        : 'used'
      : invite.expiresAt && invite.expiresAt <= now
        ? 'expired'
        : html`<a href="/signup?invite=${invite.code}">sign-up link</a>${
              invite.expiresAt &&
              html`, expires
                <time datetime=${invite.expiresAt.toISOString()}>
                  ${invite.expiresAt.toISOString().slice(0, 10)}
                </time>`
            }`
    return html`<li><code>${invite.code}</code> · ${status}</li>`
  })
  return html`
    <section class="panel" aria-label="Your invite codes">
      <h2>Your invite codes</h2>
      <p class="tiny">Each code lets one person sign up, even while blurt.trade is invite-only.</p>
      ${
        items.length > 0
          ? html`<ul class="list invite-codes">
              ${items}
            </ul>`
          : html`<p class="empty">You have no invite codes.</p>`
      }
    </section>
  `
}

function ProfilePage({
  viewer,
  profile,
  invitedBy,
  inviteCodes,
  follows,
  blurts,
  next,
  botOwners,
}: ProfilePageData) {
  const own = viewer?.id === profile.userId
  const ownsBot = viewer !== null && (botOwners ?? []).includes(viewer.username)
  const feed = blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)
  const cardPath = profileCardPath(profile)
  const actions =
    cardPath || own || viewer
      ? html`
          ${cardPath && html`<${ShareLink} href=${cardPath} username=${profile.username} />`}
          ${
            own
              ? html`<${ButtonLink}
                  href="/${profile.username}/edit"
                  icon="edit"
                  label="Edit profile"
                />`
              : viewer &&
                html`${
                    ownsBot &&
                    html`<${ButtonLink}
                      href="/settings/bots/${profile.username}"
                      icon="robot"
                      label="Manage bot"
                    />`
                  }<${FollowForm}
                    username=${profile.username}
                    following=${follows.viewerFollows}
                  />`
          }
        `
      : undefined

  return html`
    <${Page}
      title=${profile.username}
      tagline=${followTagline(follows)}
      lead=${html`<${AvatarView}
        avatar=${profile.avatar}
        label="${profile.username}'s avatar"
        size="large"
      />`}
      actions=${actions}
      aside=${html`
        <${ProfileLinks} profile=${profile} />
        ${
          inviteCodes
            ? html`<${InviteCodes} codes=${inviteCodes} />`
            : own && html`<${InviteFriends} />`
        }
      `}
    >
      <section class="panel" aria-label="Profile">
        <h2>Profile</h2>
        ${invitedBy && html`<p class="invited-by">Invited by <a href="/${invitedBy}/">${invitedBy}</a></p>`}
        ${botOwners && html`<p class="invited-by"><span class="bot-label">Bot</span> run by ${botOwners.map((owner, i) => html`${i > 0 && ', '}<a href="/${owner}/">${owner}</a>`)}</p>`}
        <p class="bio">${profile.bio || html`<span class="empty">No bio yet.</span>`}</p>
      </section>
      <section class="panel" aria-label="${profile.username} blurts">
        <h2>Blurts</h2>
        ${feed.length > 0 ? feed : html`<p class="empty">Nothing has been blurted yet.</p>`}
        ${
          next &&
          html`<${NextPageLink}
            href=${olderBlurtsUrl(`/${profile.username}/`, next)}
            label="Older blurts"
            list="blurts"
          />`
        }
      </section>
    <//>
  `
}

// The share card image of a profile (none without a bio) and of a blurt (none when deleted).
export function profileCardPath(profile: UserProfile): string | undefined {
  const text = profileCardText(profile.bio)
  return text
    ? ogProfileImagePath(
        profile.username,
        ogHash({
          text,
          username: profile.username,
          avatar: profile.avatar,
          color: profile.cardColor,
        }),
      )
    : undefined
}

const metaDescriptionMax = 160

function profilePageMeta({ profile }: ProfilePageData): PageMeta {
  const description =
    profile.bio.trim() === ''
      ? `${profile.username} on blurt.trade`
      : preview(profile.bio, metaDescriptionMax)
  const image = profileCardPath(profile)
  return {
    title: profile.username,
    description,
    canonical: `/${profile.username}/`,
    author: profile.username,
    share: {
      type: 'profile',
      title: preview(`${profile.username} on blurt.trade`, shareTitleMax),
      description,
      image,
      imageAlt: image && `${profile.username}: ${profileCardText(profile.bio)}`,
    },
  }
}

export function renderProfilePage(data: ProfilePageData): string {
  return renderDocument(h(ProfilePage, data), profilePageMeta(data))
}
