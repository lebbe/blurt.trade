import { describeAvatar } from '../../avatar.ts'
import type { ProfilePageData } from './data.ts'
import { blurtList, home } from '../shared/blurts.md.ts'
import { code, join, link, type Markdown, md, raw } from '../shared/markdown.ts'
import type { UserProfile } from '../../routes/state/profiles.ts'
import type { InviteCode } from '../../routes/state/signup.ts'
import { normalizedWebUrl } from '../../shared/limits.ts'
import { plural } from '../../ui/text.ts'
import { olderBlurtsUrl } from '../../ui/urls.ts'

// A profile page (/:username/) as Markdown: the same data as the HTML, for text/markdown
// and text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

export function profileValue(value: string): Markdown {
  const url = normalizedWebUrl(value)
  return md`${value === '' ? raw('_Not set_') : url ? link(url, url) : value}`
}

export const profileFields: [Exclude<keyof UserProfile, 'avatar'>, string][] = [
  ['homepage', 'Homepage'],
  ['x', 'X'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['github', 'GitHub'],
  ['linkedin', 'LinkedIn'],
  ['bio', 'Bio'],
]

function inviteCodeMarkdown(invite: InviteCode, now: Date): Markdown {
  const status = invite.usedAt
    ? invite.usedBy
      ? md`used by ${link(invite.usedBy, `/${invite.usedBy}/`)}`
      : 'used'
    : invite.expiresAt && invite.expiresAt <= now
      ? 'expired'
      : md`${link('sign-up link', `/signup?invite=${invite.code}`)}${invite.expiresAt && md`, expires ${invite.expiresAt}`}`
  return md`- ${code(invite.code)} · ${status}`
}

export function profilePageMarkdown({
  viewer,
  profile,
  invitedBy,
  botOwners,
  inviteCodes,
  follows,
  blurts,
  next,
}: ProfilePageData): Markdown {
  const now = new Date()
  const fields = [
    ...profileFields.map(([key, label]) => md`- ${label}: ${profileValue(String(profile[key]))}`),
    md`- Avatar: ${describeAvatar(profile.avatar)}`,
  ]
  const action = follows.viewerFollows ? '/api/unfollow' : '/api/follow'
  return md`
    # ${profile.username}

    ${home}

    ${plural(follows.followerCount, 'follower')} · ${follows.followingCount} following

    ${invitedBy && md`Invited by ${link(invitedBy, `/${invitedBy}/`)}`}

    ${botOwners && md`A bot, run by ${botOwners.map((owner, i) => md`${i > 0 ? ', ' : ''}${link(owner, `/${owner}/`)}`)}`}

    ${
      viewer &&
      viewer.id !== profile.userId &&
      md`${follows.viewerFollows ? 'You follow them. Unfollow' : 'Follow'} with ${code(`POST ${action}`)} and ${code('username')}.`
    }

    ## Profile

    ${join(fields, '\n')}

    ${viewer?.id === profile.userId && link('Edit profile', `/${profile.username}/edit`)}

    ${
      inviteCodes &&
      md`
        ## Your invite codes

        Each code lets one person sign up, even while blurt.trade is invite-only.

        ${
          inviteCodes.length > 0
            ? join(
                inviteCodes.map((invite) => inviteCodeMarkdown(invite, now)),
                '\n',
              )
            : 'You have no invite codes.'
        }
      `
    }

    ## Blurts

    ${blurtList(blurts)}

    ${next && link('Older blurts', olderBlurtsUrl(`/${profile.username}/`, next))}
  `
}
