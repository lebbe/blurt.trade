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
import { html } from '../../ui/html.ts'
import { Icon } from '../../ui/icons.ts'
import { plural, preview } from '../../ui/text.ts'
import { olderBlurtsUrl } from '../../ui/urls.ts'

// Today a plain link to the share card image, which works without JavaScript. With
// JavaScript it can become the share button of the browser or a social network.
function ShareLink({ href }: { href: string }) {
  return html`<${ButtonLink} href=${href} icon="share" label="Share" />`
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
      <h3>Links</h3>
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

function FollowForm({ username, following }: { username: string; following: boolean }) {
  return html`
    <form method="post" action=${following ? '/api/unfollow' : '/api/follow'} class="follow-form">
      <input type="hidden" name="username" value=${username} />
      <button type="submit" class=${following ? 'secondary' : undefined}>
        <${Icon} name=${following ? 'personMinus' : 'personPlus'} /><span
          >${following ? 'Unfollow' : 'Follow'}</span
        >
      </button>
    </form>
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
      <h3>Your invite codes</h3>
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
}: ProfilePageData) {
  const own = viewer?.id === profile.userId
  const feed = blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)
  const cardPath = profileCardPath(profile)
  const actions =
    cardPath || own || viewer
      ? html`
          ${cardPath && html`<${ShareLink} href=${cardPath} />`}
          ${
            own
              ? html`<${ButtonLink}
                  href="/${profile.username}/edit"
                  icon="edit"
                  label="Edit profile"
                />`
              : viewer &&
                html`<${FollowForm}
                  username=${profile.username}
                  following=${follows.viewerFollows}
                />`
          }
        `
      : undefined

  return html`
    <${Page}
      title=${profile.username}
      tagline=${`${plural(follows.followerCount, 'follower')} · ${follows.followingCount} following`}
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
