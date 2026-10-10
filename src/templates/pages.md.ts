import type { Blurt, InviteCode, UserProfile } from '../routes/state.ts'
import { avatarSchema, describeAvatar, eyeTypes, hairTypes, toothTypes } from '../avatar.ts'
import { isWebUrl } from '../limits.ts'
import {
  blurtActions,
  blurtUrl,
  deleteBlurtPath,
  discoveryAfter,
  discoveryTitles,
  feedPath,
  formatLocation,
  gridDescription,
  moreRepliesUrl,
  nearPageUrl,
  olderBlurtsUrl,
  plural,
  type AdminReportsData,
  type BlurtPageData,
  type DiscoverySection,
  type FeedData,
  type FormPageData,
  type NearData,
  type ProfileEditData,
  type ProfilePageData,
  type SettingsData,
  type SignupPageData,
  type Viewer,
  type WaitlistData,
} from './index.ts'
import { code, join, link, md, raw, type Markdown } from './markdown.ts'

// The Markdown representation of each page: the same data as the HTML, for text/markdown
// and text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

const home = link('Back to blurt.trade', '/')

function viewerLine(viewer: Viewer): Markdown {
  return viewer
    ? md`Logged in as ${link(viewer.username, `/${viewer.username}/`)} · ${link('Near you', '/near')} · ${link('Settings', '/settings')}`
    : md`${link('Log in', '/login')} or ${link('create a profile', '/createUser')} to blurt.`
}

// `replies` are quoted inline (the feed); the thread link covers the rest.
function blurtMarkdown(blurt: Blurt, replies: Blurt[] = []): Markdown {
  return md`
    ### ${blurt.username ?? 'Deleted'}

    ${link(blurt.createdAt, blurtUrl(blurt))} · ${plural(blurt.replyCount, 'reply', 'replies')}

    ${blurt.deleted ? raw('_This blurt was deleted._') : blurt.text}

    ${replies.map((reply) =>
      reply.deleted
        ? md`
> _This blurt was deleted._
          `
        : md`> **${reply.username}**: ${reply.text}`,
    )}
  `
}

// What the viewer can do to the blurt, as the requests to send.
function blurtActionsMarkdown(viewer: Viewer, blurt: Blurt, reported: boolean): Markdown | null {
  const action = blurtActions(viewer, blurt)
  if (action === 'delete') {
    return md`Delete it with ${code(`POST ${deleteBlurtPath(blurt)}`)}.`
  }
  if (action === 'report') {
    return reported
      ? md`
You reported this blurt.
        `
      : md`Report it with ${code('POST /api/report')}, ${code('blurtId')} and an optional ${code('reason')}.`
  }
  return null
}

function blurtList(blurts: Blurt[]): Markdown {
  return md`${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt)) : 'Nothing here yet.'}`
}

function discoveryMarkdown(section: DiscoverySection): Markdown {
  const { title, description } = discoveryTitles[section.kind]
  return md`
    ## ${title}

    ${description}

    ${section.blurts.map((blurt) => blurtMarkdown(blurt))}
  `
}

export function feedMarkdown(data: FeedData): Markdown {
  const { viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next } = data
  const discoverySections = (count: number) =>
    discoveryAfter(discovery, count).map(discoveryMarkdown)
  return md`
    # blurt.trade

    Say the thing. Regret it later.

    ${viewerLine(viewer)}

    ${
      hasFollowingFeed &&
      (feed === 'following'
        ? md`Following · ${link('Everyone', '/everyone')}`
        : md`${link('Following', '/')} · Everyone`)
    }

    ${
      followedBlurts.length > 0 &&
      md`
        ## From people you follow

        ${followedBlurts.map((blurt) => blurtMarkdown(blurt, blurt.replies))}
      `
    }

    ## ${feed === 'following' ? 'Following' : 'Feed'}

    ${
      blurts.length > 0
        ? blurts.map((blurt, index) => [
            blurtMarkdown(blurt, blurt.replies),
            discoverySections(index + 1),
          ])
        : feed === 'following'
          ? 'Nobody you follow has blurted yet.'
          : 'Nothing has been blurted yet.'
    }

    ${blurts.length === 0 && discoverySections(0)}

    ${next && link('Older blurts', olderBlurtsUrl(feedPath(data), next))}
  `
}

export function blurtPageMarkdown({
  viewer,
  blurt,
  parent,
  reported,
  replies,
  next,
  related,
}: BlurtPageData): Markdown {
  return md`
    # ${blurt.username ?? 'Deleted blurt'}

    ${home}

    ${
      parent &&
      md`
        ## In reply to

        ${blurtMarkdown(parent)}
      `
    }

    ${blurtMarkdown(blurt)}

    ${blurtActionsMarkdown(viewer, blurt, reported)}

    ## Replies

    ${blurtList(replies)}

    ${next && link('More replies', moreRepliesUrl(blurt, next))}

    ## Related blurts

    ${blurtList(related)}
  `
}

function profileValue(value: string): Markdown {
  return md`${value === '' ? raw('_Not set_') : isWebUrl(value) ? link(value, value) : value}`
}

const profileFields: [Exclude<keyof UserProfile, 'avatar'>, string][] = [
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
      : md`${link('sign-up link', `/createUser?invite=${invite.code}`)}${invite.expiresAt && md`, expires ${invite.expiresAt}`}`
  return md`- ${code(invite.code)} · ${status}`
}

export function profilePageMarkdown({
  viewer,
  profile,
  invitedBy,
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

export function profileEditMarkdown({ profile, location }: ProfileEditData): Markdown {
  const fields = profileFields.map(
    ([key, label]) => md`- ${code(key)} (${label}): ${profileValue(String(profile[key]))}`,
  )
  return md`
    # Edit profile: ${profile.username}

    ${link('Back to profile', `/${profile.username}/`)}

    Send ${code(`POST /${profile.username}/edit`)} as a form or as JSON. Fields left out are
    cleared. Current values:

    ${join(fields, '\n')}

    ## Avatar

    Yours: ${describeAvatar(profile.avatar)}.

    Send ${code('POST /api/avatar')} with all of ${join(Object.keys(avatarSchema.shape).map(code), ', ')}
    to change it, or with ${code('random')} for a random one. Colours are ${code('#rrggbb')}. Hair
    is one of ${join(hairTypes.map(code), ', ')}; eyes one of ${join(eyeTypes.map(code), ', ')};
    teeth one of ${join(toothTypes.map(code), ', ')}.

    ## Location

    ${location ? md`Your location: ${formatLocation(location)} (the middle of ${gridDescription}).` : "You haven't set a location."}

    Send ${code('POST /api/location')} with ${code('lat')} and ${code('lon')} to set it (only
    ${gridDescription} is stored), or with ${code('clear')} to remove it. Nobody else can see
    it. Then see ${link('blurts near you', '/near')}.
  `
}

export function nearMarkdown({ location, radius, radii, blurts, next }: NearData): Markdown {
  return md`
    # Blurts near you

    ${home}

    ${
      location
        ? md`
            From people within ${radius} km of ${formatLocation(location)}. Other radii: ${join(
              radii.filter((km) => km !== radius).map((km) => link(`${km} km`, nearPageUrl(km))),
              ', ',
            )}.

            ${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt, blurt.replies)) : 'Nobody near you has blurted yet.'}

            ${next && link('Older blurts', nearPageUrl(radius, next))}
          `
        : md`You haven't set a location. Send ${code('POST /api/location')} with ${code('lat')} and ${code('lon')} first.`
    }
  `
}

function formMarkdown(title: string, path: string, fields: Markdown, viewer: Viewer): Markdown {
  return md`
    # ${title}

    ${home}

    Send ${code(`POST ${path}`)} as a form or as JSON with ${fields}.

    ${viewer && md`You are already logged in as ${viewer.username}.`}
  `
}

export function loginMarkdown({ viewer }: FormPageData): Markdown {
  return formMarkdown('Log in', '/login', md`${code('username')} and ${code('password')}`, viewer)
}

const usernameRules = md`${code('username')} (letters, numbers and ${code('_')})`

export function createUserMarkdown({ viewer, signup, inviteCode }: SignupPageData): Markdown {
  const invite = md`${code('inviteCode')}${inviteCode && md` (yours: ${code(inviteCode)})`}`
  if (signup === 'invite') {
    return md`
      # Create a profile

      ${home}

      blurt.trade is invite-only right now. You need an invite code from someone who's already
      here to sign up.

      Send ${code('POST /createUser')} as a form or as JSON with ${usernameRules}, ${code('password')} (at least 8 characters) and ${invite}.

      ${viewer && md`You are already logged in as ${viewer.username}.`}
    `
  }
  if (signup === 'waitlist') {
    return md`
      # Create a profile

      ${home}

      Sign-up is full right now. Join the ${link('waitlist', '/waitlist')} instead.
    `
  }
  return formMarkdown(
    'Create a profile',
    '/createUser',
    md`${usernameRules}, ${code('password')} (at least 8 characters) and, optionally, ${invite}`,
    viewer,
  )
}

export function waitlistMarkdown({ signup, waiting, username, entry }: WaitlistData): Markdown {
  const status = entry
    ? entry.status === 'joined'
      ? md`${link(entry.username, `/${entry.username}/`)} has signed up.`
      : md`${entry.username} is on the waitlist.`
    : username && md`${username} isn't on the waitlist.`
  const opening =
    signup === 'open'
      ? md`Sign-up is open again: ${link('create your profile', '/createUser')}.`
      : signup === 'invite'
        ? md`Sign-up has reopened, with an invite code: ${link('sign up', '/createUser')}.`
        : md`
Sign-up is full. When it opens again, this page will say so.
          `
  return md`
    # Waitlist

    ${home}

    ${status}

    ${opening}

    ${plural(waiting, 'person', 'people')} waiting.

    ${signup === 'waitlist' && md`Send ${code('POST /waitlist')} as a form or as JSON with ${usernameRules}. No email: check back at ${code('/waitlist?username=<username>')}.`}
  `
}

export function adminReportsMarkdown({ reports }: AdminReportsData): Markdown {
  return md`
    # Reports

    ${home}

    ${
      reports.length > 0
        ? reports.map(
            ({ blurt, reports: open }) => md`
              ${blurtMarkdown(blurt)}

              ${join(
                open.map(
                  (report) =>
                    md`- ${link(report.reporter, `/${report.reporter}/`)}: ${report.reason || raw('_no reason given_')}`,
                ),
                '\n',
              )}

              Delete it with ${code(`POST ${deleteBlurtPath(blurt)}`)}, or dismiss the reports with ${code('POST /api/admin/reports/dismiss')} and ${code(`blurtId=${blurt.id}`)}.
            `,
          )
        : 'No open reports.'
    }
  `
}

export function settingsMarkdown({ viewer, activeSessions }: SettingsData): Markdown {
  return md`
    # Settings: ${viewer.username}

    ${home}

    ## Sessions

    You're logged in on ${plural(activeSessions, 'browser or device', 'browsers or devices')}.

    Send ${code('POST /api/logout-everywhere')} to log out everywhere, this client included.
    Other devices are logged out within 5 minutes.
  `
}
