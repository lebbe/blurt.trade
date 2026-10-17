import type { Blurt, InviteCode, QuotedBlurt, UserProfile } from '../routes/state.ts'
import type { Contact } from '../config.ts'
import {
  avatarSchema,
  describeAvatar,
  eyeTypes,
  hairTypes,
  headWidths,
  toothTypes,
} from '../avatar.ts'
import { blurtMaxLength, isWebUrl } from '../limits.ts'
import { themes } from '../themes.ts'
import { pageContext } from '../page-context.ts'
import {
  accountDeletionEffects,
  blurtActions,
  blurtUrl,
  deleteBlurtPath,
  discoveryAfter,
  discoveryTitles,
  feedPath,
  forgotPassword,
  formatLocation,
  gridDescription,
  moreRepliesUrl,
  nearPageUrl,
  noPasswordReset,
  olderBlurtsUrl,
  parentUrl,
  plural,
  reblurtAction,
  searchUrl,
  type AdminReportsData,
  type AdminToolsData,
  type BlurtPageData,
  type DeleteAccountData,
  type DiscoverySection,
  type FeedData,
  type FormPageData,
  type InfoPageData,
  type NearData,
  type ProfileEditData,
  type ProfilePageData,
  type SearchData,
  type SettingsData,
  type SignupPageData,
  type Viewer,
  type WaitlistData,
} from './index.ts'
import { code, join, link, md, raw, type Markdown, type MarkdownValue } from './markdown.ts'

// The Markdown representation of each page: the same data as the HTML, for text/markdown
// and text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

const home = link('Back to blurt.trade', '/')

function viewerLine(viewer: Viewer): Markdown {
  return viewer
    ? md`Logged in as ${link(viewer.username, `/${viewer.username}/`)} · ${link('Near you', '/near')} · ${link('Settings', '/settings')}`
    : md`${link('Log in', '/login')} or ${link('create a profile', '/createUser')} to blurt.`
}

// The blurt a quote quotes, as a blockquote under its text.
function quotedMarkdown(quoted: QuotedBlurt): Markdown {
  return quoted.deleted
    ? md`
> _Content is deleted._
      `
    : md`> **${quoted.username}** (${link(quoted.createdAt, blurtUrl(quoted))}): ${quoted.text}`
}

// `replies` are quoted inline (the feed); the thread link covers the rest. `inThread`: see
// BlurtCard.
function blurtMarkdown(blurt: Blurt, replies: Blurt[] = [], inThread = false): Markdown {
  const parent = !inThread && parentUrl(blurt)
  return md`
    ### ${blurt.username ?? 'Deleted'}

    ${blurt.reblurtedBy && md`Reblurted by ${link(blurt.reblurtedBy, `/${blurt.reblurtedBy}/`)}`}

    ${parent && md`Replying to ${link(blurt.parentUsername ?? 'a deleted blurt', parent)}`}

    ${link(blurt.createdAt, blurtUrl(blurt))} · ${plural(blurt.replyCount, 'reply', 'replies')}${!blurt.deleted && ` · ${likesText(blurt)} · ${reblurtsText(blurt)}`}

    ${blurt.deleted ? raw('_This blurt was deleted._') : blurt.text}

    ${blurt.quoted && quotedMarkdown(blurt.quoted)}

    ${replies.map((reply) =>
      reply.deleted
        ? md`
> _This blurt was deleted._
          `
        : md`> **${reply.username}**: ${reply.text}`,
    )}
  `
}

function likesText(blurt: Blurt): string {
  return `${plural(blurt.likeCount, 'like')}${blurt.viewerLikes ? ' (you like it)' : ''}`
}

function reblurtsText(blurt: Blurt): string {
  return `${plural(blurt.reblurtCount, 'reblurt')}${blurt.viewerReblurted ? ' (you reblurted it)' : ''}`
}

// What the viewer can do to the blurt, as the requests to send.
function blurtActionsMarkdown(viewer: Viewer, blurt: Blurt, reported: boolean): Markdown | null {
  const like =
    viewer &&
    !blurt.deleted &&
    md`${blurt.viewerLikes ? 'Unlike' : 'Like'} it with ${code(`POST ${blurt.viewerLikes ? '/api/unlike' : '/api/like'}`)} and ${code(`blurtId=${blurt.id}`)}.`
  const reblurt = reblurtAction(viewer, blurt)
  const quote =
    viewer &&
    !blurt.deleted &&
    md`Quote it with ${code('POST /api/blurts')}, ${code('text')} and ${code(`reblurtOfId=${blurt.id}`)}.`
  return md`
    ${like}

    ${reblurt && md`${reblurt === 'unreblurt' ? 'Undo your reblurt' : 'Reblurt it'} with ${code(`POST /api/${reblurt}`)} and ${code(`blurtId=${blurt.id}`)}.`}

    ${quote}

    ${actionMarkdown(viewer, blurt, reported)}
  `
}

function actionMarkdown(viewer: Viewer, blurt: Blurt, reported: boolean): Markdown | null {
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

function blurtList(blurts: Blurt[], inThread = false): Markdown {
  return md`${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt, [], inThread)) : 'Nothing here yet.'}`
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

    ${blurtMarkdown(blurt, [], true)}

    ${blurtActionsMarkdown(viewer, blurt, reported)}

    ## Replies

    ${blurtList(replies, true)}

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
    to change it, or with ${code('random')} for a random one. Colours are ${code('#rrggbb')}. The
    head is one of ${join(headWidths.map(code), ', ')} wide. Hair is one of ${join(hairTypes.map(code), ', ')}; eyes one of ${join(eyeTypes.map(code), ', ')};
    teeth one of ${join(toothTypes.map(code), ', ')}.

    ## Location

    ${location ? md`Your location: ${formatLocation(location)} (the middle of ${gridDescription}).` : "You haven't set a location."}

    Send ${code('POST /api/location')} with ${code('lat')} and ${code('lon')} to set it (only
    ${gridDescription} is stored), or with ${code('clear')} to remove it. Nobody else can see
    it. Then see ${link('blurts near you', '/near')}.

    ## Theme

    Yours: ${code(pageContext().theme)}.

    Send ${code('POST /api/theme')} with ${code('theme')}, one of ${join(
      themes.map((theme) => code(theme.id)),
      ', ',
    )},
    to pick the colours of the HTML pages, on every device you're logged in on.
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

export function searchMarkdown({ query, users, blurts, next }: SearchData): Markdown {
  return md`
    # Search

    ${home}

    Search usernames and blurts with ${code('GET /search?q=<words>')}.

    ${
      query === ''
        ? 'Nothing searched for yet.'
        : md`
            Results for ${code(query)}

            ${
              users.length > 0 &&
              md`
                ## People

                ${users.map((user) => md`- ${link(user.username, `/${user.username}/`)}`)}
              `
            }

            ## Blurts

            ${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt)) : 'No blurts match.'}

            ${next && link('Older blurts', searchUrl(query, next))}
          `
    }
  `
}

// How to reach the owner privately, or a pointer to /about when no address is set up.
function privateContact({ email }: Contact): Markdown {
  return email
    ? md`email ${link(email, `mailto:${email}`)}`
    : md`the contact on the ${link('About page', '/about')}`
}

export function aboutMarkdown({ contact }: InfoPageData): Markdown {
  const { email, issuesUrl, securityUrl } = contact
  const security = securityUrl
    ? md`report it privately with GitHub's ${link('Report a vulnerability', securityUrl)}${email ? ', or by email' : ''}.`
    : 'email it.'
  return md`
    # About blurt.trade

    ${home}

    blurt.trade is a small hobby site for short posts, blurts, of up to ${blurtMaxLength} characters. It works without JavaScript, has no ads and no tracking, and collects as little about you as it can: see ${link('Privacy', '/privacy')} and ${link('Terms', '/terms')}.

    ## Contact

    ${issuesUrl && md`Questions, bugs and ideas: open an issue on ${link('GitHub', issuesUrl)}.`}

    ${email && md`Anything that shouldn't be public: ${link(email, `mailto:${email}`)}.`}

    ${!issuesUrl && !email && 'No contact address has been set up yet.'}

    ${
      issuesUrl &&
      md`
        **GitHub issues are public**: anyone can read them. Never put these in one:

        - A security hole: ${security}
        - Illegal content, or someone's private information posted here: use the Report button on the blurt (when you're logged in)${email ? ', or email' : ''}. Don't repeat the content or the information anywhere public.
        - Anything about your own account or data: ${email ? link('email', `mailto:${email}`) : 'ask without details'}.
      `
    }
  `
}

export function termsMarkdown({ contact }: InfoPageData): Markdown {
  return md`
    # Terms

    ${home}

    By using blurt.trade you agree to these terms. They're short on purpose.

    ## Your posts

    You're responsible for what you post. Everything you post is public: blurts, replies and your profile. You keep the rights to it, and let blurt.trade show it, which is the point.

    ## What's not allowed

    Nothing illegal. No harassment, no threats, no spam, and no one else's private information. Don't try to break the site or get around its limits.

    ## Removal

    The owner can remove any blurt or profile, and close any account, at any time and without notice, for example when it breaks these terms.

    ## Your password

    ${noPasswordReset}

    ## No warranty

    blurt.trade is a hobby project, provided as it is, with no warranty of any kind. It may be down, lose data, change or shut down. As far as the law allows, the owner isn't liable for any loss from using it.

    ## Changes

    These terms may change; this page always has the current version. Questions: ${privateContact(contact)}.
  `
}

export function privacyMarkdown({ contact }: InfoPageData): Markdown {
  return md`
    # Privacy

    ${home}

    blurt.trade collects as little as it can. No email address, no real name, no phone number. No analytics, no ads, no tracking, and nothing loaded from other sites.

    ## What is stored

    For each account:

    - Your username, a hash of your password (Argon2id: the password itself is never stored), and when you signed up.
    - The profile fields you fill in: bio, homepage and social links, your avatar's settings, the colour theme and share card colour you picked.
    - Only if you set it: a coarse location, ${gridDescription}. Only you see it, but it puts your blurts in "Near you" for people nearby.
    - Your blurts and replies, with when you posted them, and for each one an embedding: numbers describing what it's about, for related blurts and "You might like". It's computed on our own server; your text isn't sent anywhere.
    - Who you follow.
    - Blurts you like, and when. Only the number of likes on a blurt is public: nobody else sees who liked it.
    - Blurts you reblurt, and when. Reblurts are public: they show on your profile and in your followers' feeds. A quote is a blurt of your own, with the quoted blurt under it.
    - Your invite codes, and who signed up with them. Who invited you shows on your profile.
    - Blurts you report, with your reason and when.
    - Your sessions: one record per login, with when it started and was last used. No IP address and no browser details.

    The waitlist stores only the username you'd like, whether you've signed up since, and when you joined it.

    For deleted accounts, only the username is kept, in lower case and with nothing else, so it can't be taken again.

    Public: your username, profile, avatar, blurts, reblurts, follower, like and reblurt counts, and who invited you. Everything else is private, though admins see who reported what.

    ## What is not stored

    - No email address. So we can't contact you, and there's **no password reset**: a lost password can't be recovered, and neither can the account.
    - No IP addresses in the database or in the app's logs. Rate limiting counts requests per IP address in memory only, until the limit has refilled (an hour at most), and never writes them down. The web server's access log keeps addresses shortened (the last part dropped) for at most 14 days, to spot abuse.
    - The app's logs hold what was asked for and how it went (method, path, status, time), never what you posted, your password or your cookies.

    ## Cookies

    Three, all needed for the site to work, none for tracking, so there's no cookie banner. All are HttpOnly and only sent to blurt.trade.

    - ${code('access_token')}: shows you're logged in, and which colour theme you picked. Lasts 5 minutes.
    - ${code('refresh_token')}: keeps you logged in. Renewed as you use the site; expires after 400 days without a visit, or when you log out.
    - ${code('recent_write')}: set for a few seconds after you post or change something, so you see your own change straight away.

    ## Backups

    No backups of the database are currently being made.

    ## Deleting your account

    ${link('Settings', '/settings')} has "Delete my account", which asks for your password. It deletes at once, in one go, everything above that belongs to the account: your profile, avatar and location, the text of your blurts and their embeddings, your reblurts, who you follow and who follows you, your likes (and the likes on your blurts), your invite codes, your reports, your sessions and your waitlist entry. You're logged out everywhere.

    What stays: an empty record of the account, with no username, password or profile, and an empty row for each of your blurts, with no text, which shows nowhere and names nobody. A blurt someone replied to shows as an empty placeholder, with no text and no author, so the thread still reads. The invite code you signed up with stays marked as used, with nothing linking it to you. Your username goes on the list of retired names, with nothing else, so nobody can sign up as you later. The count of sign-ups so far doesn't go down. Backups still hold the account until they expire, 30 days at most.

    ## Your rights

    You can ask what is stored about you, and have it corrected or deleted: ${privateContact(contact)}.
  `
}

function formMarkdown(
  title: string,
  path: string,
  fields: Markdown,
  viewer: Viewer,
  note?: MarkdownValue,
): Markdown {
  return md`
    # ${title}

    ${home}

    Send ${code(`POST ${path}`)} as a form or as JSON with ${fields}.

    ${note}

    ${viewer && md`You are already logged in as ${viewer.username}.`}
  `
}

export function loginMarkdown({ viewer }: FormPageData): Markdown {
  return formMarkdown(
    'Log in',
    '/login',
    md`${code('username')} and ${code('password')}`,
    viewer,
    md`${forgotPassword} ${link('Privacy', '/privacy')}.`,
  )
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

      ${noPasswordReset}

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
    noPasswordReset,
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

export function adminToolsMarkdown({ minted }: AdminToolsData): Markdown {
  return md`
    # Admin

    ${home}

    ${minted ? md`Minted for ${minted.username}:` : ''}

    ${
      minted
        ? join(
            minted.codes.map((minted) => md`- ${code(minted)}`),
            '\n',
          )
        : ''
    }

    - ${link('Open reports', '/admin/reports')}
    - Delete a blurt: ${code('POST /api/admin/blurts/delete')} with ${code('blurtId')}
    - Dismiss reports: ${code('POST /api/admin/reports/dismiss')} with ${code('blurtId')}
    - Mint invite codes: ${code('POST /api/admin/invites')} with ${code('username')}, ${code('count')} (1–1000) and optionally ${code('days')}
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

    ## Delete account

    Deletes your profile and your blurts for good: see ${link('Delete my account', '/settings/delete')}.
  `
}

export function deleteAccountMarkdown({ viewer }: DeleteAccountData): Markdown {
  return md`
    # Delete account: ${viewer.username}

    ${link('Back to settings', '/settings')}

    ${accountDeletionEffects.map((effect) => md`- ${effect}`)}

    Send ${code('POST /settings/delete')} as a form or as JSON with your ${code('password')} to confirm.
  `
}
