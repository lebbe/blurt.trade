import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clientBuild } from '../src/client-modules.ts'
import { runWithPageContext, type PageContext } from '../src/page-context.ts'
import { renderErrorPage } from '../src/pages/error/error.html.ts'
import { renderAdminReportsPage, renderAdminToolsPage } from '../src/pages/admin/admin.html.ts'
import {
  renderCreateUserPage,
  renderLoginPage,
  renderWaitlistPage,
} from '../src/pages/auth/auth.html.ts'
import { renderBlurtPage } from '../src/pages/blurt/blurt.html.ts'
import { renderFeedPage } from '../src/pages/feed/feed.html.ts'
import { renderAboutPage, renderPrivacyPage, renderTermsPage } from '../src/pages/info/info.html.ts'
import { renderNearPage } from '../src/pages/near/near.html.ts'
import { renderNotificationsPage } from '../src/pages/notifications/notifications.html.ts'
import { renderPeoplePage } from '../src/pages/people/people.html.ts'
import { renderProfileEditPage } from '../src/pages/profile-edit/profile-edit.html.ts'
import { renderProfilePage } from '../src/pages/profile/profile.html.ts'
import { renderSearchPage } from '../src/pages/search/search.html.ts'
import { renderDeleteAccountPage, renderSettingsPage } from '../src/pages/settings/settings.html.ts'
import { adminReportsMarkdown, adminToolsMarkdown } from '../src/pages/admin/admin.md.ts'
import { createUserMarkdown, loginMarkdown, waitlistMarkdown } from '../src/pages/auth/auth.md.ts'
import { blurtPageMarkdown } from '../src/pages/blurt/blurt.md.ts'
import { feedMarkdown } from '../src/pages/feed/feed.md.ts'
import { aboutMarkdown, privacyMarkdown, termsMarkdown } from '../src/pages/info/info.md.ts'
import { nearMarkdown } from '../src/pages/near/near.md.ts'
import { notificationsMarkdown } from '../src/pages/notifications/notifications.md.ts'
import { peopleMarkdown } from '../src/pages/people/people.md.ts'
import { profileEditMarkdown } from '../src/pages/profile-edit/profile-edit.md.ts'
import { profilePageMarkdown } from '../src/pages/profile/profile.md.ts'
import { searchMarkdown } from '../src/pages/search/search.md.ts'
import { deleteAccountMarkdown, settingsMarkdown } from '../src/pages/settings/settings.md.ts'
import type { Avatar } from '../src/avatar.ts'
import type { Blurt, FeedItem, Notification, UserProfile } from '../src/routes/state.ts'

// Every page, as HTML and as Markdown, rendered from fixed data in a fixed page context and
// compared byte for byte with the files in test/snapshots/. It pins the output of the
// templates, so refactoring them (moving components, changing how they get the page
// context) can't change a page by accident. After an intended change, regenerate the files
// with UPDATE_SNAPSHOTS=1 npm test and review the diff.

const snapshotDir = join(import.meta.dirname, 'snapshots')
const update = process.env.UPDATE_SNAPSHOTS === '1'

// Settings the templates read from the environment, fixed while rendering. Rendering is
// synchronous, so other test files sharing the process never see them.
const fixedEnv: Record<string, string | undefined> = {
  PUBLIC_URL: 'https://blurt.example',
  CONTACT_EMAIL: 'owner@blurt.example',
  CONTACT_REPO_URL: 'https://github.com/example/blurt',
}

function withFixedEnv<T>(callback: () => T): T {
  const saved = Object.fromEntries(Object.keys(fixedEnv).map((key) => [key, process.env[key]]))
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
  apply(fixedEnv)
  try {
    return callback()
  } finally {
    apply(saved)
  }
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 12, minute, 0))

const avatar: Avatar = {
  headWidth: 'regular',
  skin: '#f1c27d',
  hairType: 'tuft',
  hairColor: '#2c222b',
  eyeType: 'classic',
  eyeColor: '#ffffff',
  pupilColor: '#000000',
  toothType: 'two',
  toothColor: '#ffffff',
}
const otherAvatar: Avatar = {
  headWidth: 'broad',
  skin: '#8d5524',
  hairType: 'afro',
  hairColor: '#090806',
  eyeType: 'angry',
  eyeColor: '#fdfdf5',
  pupilColor: '#2b4f81',
  toothType: 'gap',
  toothColor: '#f4ecd0',
}
const photoAvatar: Avatar = { ...avatar, photo: { user: 3, version: 2, cut: 60 } }

function blurt(id: number, fields: Partial<Blurt> = {}): Blurt {
  return {
    id,
    username: 'ada',
    text: `Blurt number ${id}`,
    createdAt: at(id),
    parentId: null,
    parentUsername: null,
    replyCount: 0,
    avatar,
    deleted: false,
    likeCount: 0,
    viewerLikes: false,
    reblurtCount: 0,
    viewerReblurted: false,
    reblurtedBy: null,
    quoted: null,
    picture: null,
    ...fields,
  }
}

const deletedBlurt = (id: number, fields: Partial<Blurt> = {}) =>
  blurt(id, { username: null, text: null, avatar: null, deleted: true, ...fields })

const reply = blurt(11, {
  username: 'grace',
  avatar: otherAvatar,
  text: 'A reply with [a link](https://example.com/page?utm_source=x&keep=1) & <tags>',
  parentId: 10,
  parentUsername: 'ada',
  likeCount: 1,
})

const main = blurt(10, {
  text: 'Look at https://example.com/a_(b), and www-free text. Also http://bad host',
  replyCount: 3,
  likeCount: 2,
  viewerLikes: true,
  reblurtCount: 1,
  picture: { width: 640, height: 480 },
})

const quote = blurt(12, {
  username: 'grace',
  avatar: photoAvatar,
  text: 'Quoting this one',
  quoted: {
    id: 10,
    username: 'ada',
    text: main.text,
    createdAt: main.createdAt,
    avatar,
    deleted: false,
  },
  reblurtCount: 1,
  viewerReblurted: true,
})

const quoteOfDeleted = blurt(13, {
  quoted: { id: 9, username: null, text: null, createdAt: at(9), avatar: null, deleted: true },
})

const reblurt = blurt(14, { username: 'grace', avatar: otherAvatar, reblurtedBy: 'ada' })

const replyToDeleted = blurt(15, { parentId: 9, parentUsername: null })

const feedItems: FeedItem[] = [
  { ...main, replies: [reply] },
  { ...quote, replies: [] },
  { ...quoteOfDeleted, replies: [] },
  { ...reblurt, replies: [] },
  { ...replyToDeleted, replies: [] },
  { ...deletedBlurt(16, { replyCount: 2 }), replies: [] },
]

const profile: UserProfile = {
  userId: 1,
  username: 'ada',
  homepage: 'https://ada.example/',
  x: 'ada_x',
  instagram: '',
  tiktok: 'ada_tok',
  youtube: '',
  github: 'ada-gh',
  linkedin: '',
  bio: 'Counts things.\nWrites them down. https://ada.example/notes',
  avatar,
  cardColor: 'plum',
}

const notifications: Notification[] = [
  {
    id: 1,
    kind: 'reply',
    actor: 'grace',
    avatar: otherAvatar,
    blurtId: 11,
    blurtUsername: 'grace',
    text: reply.text,
    createdAt: at(11),
    read: false,
  },
  {
    id: 2,
    kind: 'reblurt',
    actor: 'grace',
    avatar: photoAvatar,
    blurtId: 10,
    blurtUsername: 'ada',
    text: main.text,
    createdAt: at(12),
    read: false,
  },
  {
    id: 3,
    kind: 'followed_blurt',
    actor: 'linus',
    avatar: null,
    blurtId: 20,
    blurtUsername: 'linus',
    text: null,
    createdAt: at(13),
    read: true,
  },
  {
    id: 4,
    kind: 'quote',
    actor: 'grace',
    avatar: otherAvatar,
    blurtId: 12,
    blurtUsername: 'grace',
    text: quote.text,
    createdAt: at(14),
    read: false,
  },
]

const ada = { id: 1, username: 'ada' }
const contact = {
  email: 'owner@blurt.example',
  issuesUrl: 'https://github.com/example/blurt/issues',
  securityUrl: 'https://github.com/example/blurt/security/advisories/new',
}
const noContact = { email: null, issuesUrl: null, securityUrl: null }

const anonymous: PageContext = {
  viewer: null,
  isAdmin: false,
  unreadNotifications: 0,
  path: '/',
  theme: 'cobalt-quietude',
  timeZone: 'UTC',
  locale: 'en-GB',
  pickedLocale: null,
  javascript: true,
}

const loggedIn: PageContext = {
  viewer: ada,
  isAdmin: true,
  unreadNotifications: 3,
  path: '/ada/',
  theme: 'plum-steel',
  timeZone: 'Europe/Oslo',
  locale: 'nb-NO',
  pickedLocale: 'nb-NO',
  javascript: true,
}

const quiet: PageContext = {
  ...loggedIn,
  isAdmin: false,
  unreadNotifications: 0,
  path: '/settings',
  theme: 'forest-alloy',
  timeZone: 'America/New_York',
  locale: 'en-US',
  pickedLocale: null,
  javascript: false, // so the settings and the frame are pinned with JavaScript off too
}

type Snapshot = { name: string; context: PageContext; html?: () => string; markdown?: () => string }

const md = (value: { toString(): string }) => `${value}\n`

function pages(): Snapshot[] {
  const feed = {
    viewer: ada,
    feed: 'following' as const,
    hasFollowingFeed: true,
    followedBlurts: [],
    blurts: feedItems,
    discovery: [
      { kind: 'similar' as const, after: 2, blurts: [blurt(30, { username: 'linus' })] },
      { kind: 'nearby' as const, after: 4, blurts: [blurt(31, { username: 'grace' })] },
    ],
    next: '2026-10-17T12:00:00.000000Z_5',
  }
  const everyone = {
    viewer: null,
    feed: 'everyone' as const,
    hasFollowingFeed: false,
    followedBlurts: [{ ...blurt(40, { username: 'grace' }), replies: [] }],
    blurts: [],
    discovery: [{ kind: 'similar' as const, after: 0, blurts: [blurt(41)] }],
    next: null,
  }
  const blurtPage = {
    viewer: ada,
    blurt: reply,
    parent: main,
    reported: false,
    replies: [blurt(17, { parentId: 11, parentUsername: 'grace' })],
    next: '2026-10-17T12:17:00.000000Z_17',
    related: [quote, deletedBlurt(18)],
    cardColor: 'plum' as const,
  }
  const ownBlurtPage = {
    ...blurtPage,
    blurt: main,
    parent: null,
    reported: true,
    replies: [],
    next: null,
    related: [],
    cardColor: null,
  }
  const deletedPage = {
    viewer: null,
    blurt: deletedBlurt(19, { replyCount: 1 }),
    parent: null,
    reported: false,
    replies: [reply],
    next: null,
    related: [],
  }
  const profilePage = {
    viewer: ada,
    profile,
    invitedBy: 'grace',
    inviteCodes: [
      { code: 'ABCD-EFGH-JKLM', usedBy: null, usedAt: null, expiresAt: at(50), createdAt: at(1) },
      {
        code: 'NPQR-STUV-WXYZ',
        usedBy: 'linus',
        usedAt: at(20),
        expiresAt: null,
        createdAt: at(2),
      },
    ],
    follows: { followerCount: 1, followingCount: 2, viewerFollows: false },
    blurts: [main, quote, deletedBlurt(16)],
    next: '2026-10-17T12:10:00.000000Z_10',
  }
  const strangerProfile = {
    ...profilePage,
    viewer: null,
    profile: { ...profile, username: 'grace', bio: '', avatar: photoAvatar, cardColor: null },
    invitedBy: null,
    inviteCodes: null,
    follows: { followerCount: 0, followingCount: 0, viewerFollows: false },
    blurts: [],
    next: null,
  }
  const followedProfile = {
    ...strangerProfile,
    viewer: ada,
    follows: { followerCount: 1, followingCount: 1, viewerFollows: true },
  }
  const profileEdit = {
    viewer: ada,
    profile,
    location: { lat: 59.5, lon: 10.5 },
    notifications: { followedBlurts: true, replies: false, reblurts: true },
  }
  const near = {
    viewer: ada,
    location: { lat: -33.5, lon: -70.5 },
    radius: 50,
    radii: [10, 50, 200],
    blurts: [{ ...main, replies: [] }],
    next: '2026-10-17T12:10:00.000000Z_10',
  }
  const nowhere = { ...near, location: null, blurts: [], next: null }
  const search = {
    viewer: null,
    query: 'ada & <friends>',
    users: [
      { username: 'ada', avatar },
      { username: 'adam', avatar: photoAvatar },
    ],
    blurts: [main, reblurt],
    next: '2026-10-17T12:10:00.000000Z_10',
  }
  const emptySearch = { viewer: ada, query: '', users: [], blurts: [], next: null }
  const people = {
    viewer: null,
    people: [
      {
        username: 'ada',
        avatar,
        bio: profile.bio,
        joinedAt: at(1),
        blurtCount: 12,
        followerCount: 1,
        lastBlurtAt: at(10),
      },
      {
        username: 'grace',
        avatar: photoAvatar,
        bio: '',
        joinedAt: at(2),
        blurtCount: 0,
        followerCount: 0,
        lastBlurtAt: null,
      },
    ],
    next: 'grace',
  }
  const unreadNotifications = {
    viewer: ada,
    read: false,
    unread: 3,
    notifications,
    next: '2026-10-17T12:11:00.000000Z_1',
  }
  const readNotifications = {
    ...unreadNotifications,
    read: true,
    unread: 0,
    notifications: [],
    next: null,
  }
  const info = { viewer: null, contact, inviteOnly: true }
  const infoNoContact = { viewer: ada, contact: noContact, inviteOnly: false }
  const signup = { viewer: null, signup: 'invite' as const, inviteCode: 'ABCD-EFGH-JKLM' }
  const openSignup = { viewer: null, signup: 'open' as const, inviteCode: null }
  const waitlist = {
    viewer: null,
    signup: 'waitlist' as const,
    waiting: 7,
    username: 'hopeful',
    entry: { username: 'hopeful', status: 'waiting' as const, createdAt: at(5) },
  }
  const joinedWaitlist = {
    ...waitlist,
    username: 'joined',
    entry: { username: 'joined', status: 'joined' as const, createdAt: at(6) },
  }
  const unknownWaitlist = { ...waitlist, username: 'nobody', entry: null }
  const adminTools = {
    viewer: ada,
    limits: { count: 40, softLimit: 50, hardLimit: 100, state: 'open' as const },
    minted: { username: 'grace', codes: ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'] },
  }
  const adminReports = {
    viewer: ada,
    reports: [
      {
        blurt: quote,
        reports: [
          { reporter: 'linus', reason: 'Rude & <loud>', createdAt: at(30) },
          { reporter: 'ada', reason: '', createdAt: at(31) },
        ],
      },
    ],
  }
  const settings = { viewer: ada, activeSessions: 2 }
  const deleteAccount = { viewer: ada, inviteOnly: true }

  return [
    {
      name: 'feed-following',
      context: { ...loggedIn, path: '/' },
      html: () => renderFeedPage(feed),
      markdown: () => md(feedMarkdown(feed)),
    },
    {
      name: 'feed-following-composer-error',
      context: { ...quiet, path: '/' },
      html: () =>
        renderFeedPage(
          { ...feed, discovery: [] },
          { text: 'Too <long>', validationError: 'Blurts are at most 280 characters' },
        ),
    },
    {
      name: 'feed-everyone-anonymous',
      context: anonymous,
      html: () => renderFeedPage(everyone),
      markdown: () => md(feedMarkdown(everyone)),
    },
    {
      name: 'feed-everyone-empty',
      context: { ...quiet, path: '/everyone' },
      html: () =>
        renderFeedPage({
          ...everyone,
          viewer: ada,
          feed: 'everyone',
          hasFollowingFeed: true,
          followedBlurts: [],
          discovery: [],
        }),
      markdown: () =>
        md(
          feedMarkdown({
            ...everyone,
            viewer: ada,
            hasFollowingFeed: true,
            followedBlurts: [],
            discovery: [],
          }),
        ),
    },
    {
      name: 'blurt-reply',
      context: { ...loggedIn, path: '/grace/11' },
      html: () => renderBlurtPage(blurtPage),
      markdown: () => md(blurtPageMarkdown(blurtPage)),
    },
    {
      name: 'blurt-reply-report-error',
      context: { ...loggedIn, path: '/grace/11' },
      html: () =>
        renderBlurtPage(
          blurtPage,
          { text: 'My take', reblurtOfId: 11, validationError: 'Say something' },
          'Reasons are at most 500 characters',
        ),
    },
    {
      name: 'blurt-reply-composer-error',
      context: { ...loggedIn, path: '/grace/11' },
      html: () =>
        renderBlurtPage(blurtPage, { text: 'Reply text', parentId: 11, validationError: 'Nope' }),
    },
    {
      name: 'blurt-own',
      context: { ...quiet, path: '/ada/10' },
      html: () => renderBlurtPage(ownBlurtPage),
      markdown: () => md(blurtPageMarkdown(ownBlurtPage)),
    },
    {
      name: 'blurt-deleted-anonymous',
      context: { ...anonymous, path: '/deleted/19' },
      html: () => renderBlurtPage(deletedPage),
      markdown: () => md(blurtPageMarkdown(deletedPage)),
    },
    {
      name: 'profile-own',
      context: loggedIn,
      html: () => renderProfilePage(profilePage),
      markdown: () => md(profilePageMarkdown(profilePage)),
    },
    {
      name: 'profile-anonymous',
      context: { ...anonymous, path: '/grace/' },
      html: () => renderProfilePage(strangerProfile),
      markdown: () => md(profilePageMarkdown(strangerProfile)),
    },
    {
      name: 'profile-followed',
      context: { ...quiet, path: '/grace/' },
      html: () => renderProfilePage(followedProfile),
      markdown: () => md(profilePageMarkdown(followedProfile)),
    },
    {
      name: 'profile-edit',
      context: { ...loggedIn, path: '/ada/edit' },
      html: () => renderProfileEditPage(profileEdit),
      markdown: () => md(profileEditMarkdown(profileEdit)),
    },
    {
      name: 'profile-edit-errors',
      context: { ...quiet, path: '/ada/edit' },
      html: () =>
        renderProfileEditPage({
          ...profileEdit,
          profile: { ...profile, avatar: photoAvatar, cardColor: null, bio: '' },
          location: null,
          validationError: 'Homepage must be a web address',
          locationError: 'Pick a place on the map',
          avatarError: 'Pick a hair type',
          pictureError: 'That is not a picture',
        }),
      markdown: () =>
        md(
          profileEditMarkdown({
            ...profileEdit,
            profile: { ...profile, avatar: photoAvatar, cardColor: null, bio: '' },
            location: null,
          }),
        ),
    },
    {
      name: 'near',
      context: { ...loggedIn, path: '/near' },
      html: () => renderNearPage(near),
      markdown: () => md(nearMarkdown(near)),
    },
    {
      name: 'near-no-location',
      context: { ...quiet, path: '/near' },
      html: () => renderNearPage(nowhere),
      markdown: () => md(nearMarkdown(nowhere)),
    },
    {
      name: 'search',
      context: { ...anonymous, path: '/search' },
      html: () => renderSearchPage(search),
      markdown: () => md(searchMarkdown(search)),
    },
    {
      name: 'search-empty',
      context: { ...loggedIn, path: '/search' },
      html: () => renderSearchPage(emptySearch),
      markdown: () => md(searchMarkdown(emptySearch)),
    },
    {
      name: 'people',
      context: { ...anonymous, path: '/people' },
      html: () => renderPeoplePage(people),
      markdown: () => md(peopleMarkdown(people)),
    },
    {
      name: 'notifications-unread',
      context: { ...loggedIn, path: '/ada/notifications/' },
      html: () => renderNotificationsPage(unreadNotifications),
      markdown: () => md(notificationsMarkdown(unreadNotifications)),
    },
    {
      name: 'notifications-read',
      context: { ...quiet, path: '/ada/notifications/' },
      html: () => renderNotificationsPage(readNotifications),
      markdown: () => md(notificationsMarkdown(readNotifications)),
    },
    {
      name: 'about',
      context: { ...anonymous, path: '/about' },
      html: () => renderAboutPage(info),
      markdown: () => md(aboutMarkdown(info)),
    },
    {
      name: 'about-javascript-off',
      context: { ...anonymous, path: '/about', javascript: false },
      html: () => renderAboutPage(info),
      markdown: () => md(aboutMarkdown(info)),
    },
    {
      name: 'about-no-contact',
      context: { ...quiet, path: '/about' },
      html: () => renderAboutPage(infoNoContact),
      markdown: () => md(aboutMarkdown(infoNoContact)),
    },
    {
      name: 'terms',
      context: { ...anonymous, path: '/terms' },
      html: () => renderTermsPage(info),
      markdown: () => md(termsMarkdown(info)),
    },
    {
      name: 'privacy',
      context: { ...anonymous, path: '/privacy' },
      html: () => renderPrivacyPage(info),
      markdown: () => md(privacyMarkdown(info)),
    },
    {
      name: 'privacy-open',
      context: { ...loggedIn, path: '/privacy' },
      html: () => renderPrivacyPage(infoNoContact),
      markdown: () => md(privacyMarkdown(infoNoContact)),
    },
    {
      name: 'login',
      context: { ...anonymous, path: '/login' },
      html: () => renderLoginPage(),
      markdown: () => md(loginMarkdown({ viewer: null })),
    },
    {
      name: 'login-error',
      context: { ...anonymous, path: '/login' },
      html: () => renderLoginPage({ username: 'ada', validationError: 'Wrong password' }),
      markdown: () => md(loginMarkdown({ viewer: ada })),
    },
    {
      name: 'signup-invite',
      context: { ...anonymous, path: '/signup' },
      html: () => renderCreateUserPage({ ...signup, username: 'new', validationError: 'Taken' }),
      markdown: () => md(createUserMarkdown(signup)),
    },
    {
      name: 'signup-open',
      context: { ...anonymous, path: '/signup' },
      html: () => renderCreateUserPage(openSignup),
      markdown: () => md(createUserMarkdown(openSignup)),
    },
    {
      name: 'signup-waitlist',
      context: { ...anonymous, path: '/signup' },
      html: () => renderCreateUserPage({ ...signup, signup: 'waitlist', inviteCode: null }),
      markdown: () => md(createUserMarkdown({ ...signup, signup: 'waitlist', inviteCode: null })),
    },
    {
      name: 'waitlist',
      context: { ...anonymous, path: '/waitlist' },
      html: () => renderWaitlistPage(waitlist, { username: 'x', validationError: 'Too short' }),
      markdown: () => md(waitlistMarkdown(waitlist)),
    },
    {
      name: 'waitlist-joined',
      context: { ...anonymous, path: '/waitlist' },
      html: () => renderWaitlistPage(joinedWaitlist),
      markdown: () => md(waitlistMarkdown(joinedWaitlist)),
    },
    {
      name: 'waitlist-unknown',
      context: { ...anonymous, path: '/waitlist' },
      html: () => renderWaitlistPage({ ...unknownWaitlist, signup: 'invite' }),
      markdown: () => md(waitlistMarkdown({ ...unknownWaitlist, signup: 'invite' })),
    },
    {
      name: 'admin-tools',
      context: { ...loggedIn, path: '/admin' },
      html: () => renderAdminToolsPage(adminTools),
      markdown: () => md(adminToolsMarkdown(adminTools)),
    },
    {
      name: 'admin-reports',
      context: { ...loggedIn, path: '/admin/reports' },
      html: () => renderAdminReportsPage(adminReports),
      markdown: () => md(adminReportsMarkdown(adminReports)),
    },
    {
      name: 'admin-reports-empty',
      context: { ...loggedIn, path: '/admin/reports' },
      html: () => renderAdminReportsPage({ viewer: ada, reports: [] }),
      markdown: () => md(adminReportsMarkdown({ viewer: ada, reports: [] })),
    },
    {
      name: 'settings',
      context: quiet,
      html: () => renderSettingsPage(settings),
      markdown: () => md(settingsMarkdown(settings)),
    },
    {
      name: 'settings-delete',
      context: { ...quiet, path: '/settings/delete' },
      html: () => renderDeleteAccountPage(deleteAccount, 'Type your username to confirm'),
      markdown: () => md(deleteAccountMarkdown(deleteAccount)),
    },
    {
      name: 'error-404',
      context: { ...anonymous, path: '/nope' },
      html: () => renderErrorPage({ status: 404, message: 'No such page' }),
    },
    {
      name: 'error-401',
      context: { ...anonymous, path: '/settings' },
      html: () => renderErrorPage({ status: 401, message: 'Log in first' }),
    },
    {
      name: 'error-500',
      context: { ...loggedIn, path: '/ada/' },
      html: () =>
        renderErrorPage({ status: 500, message: 'Something went wrong', requestId: 'req-123' }),
    },
  ]
}

// The client modules' URLs carry a hash of their contents (src/client-modules.ts), which
// changes with every edit to src/ui, src/shared or src/client; the snapshots don't.
const normalize = (output: string) =>
  output.replaceAll(`/static/js/${clientBuild}/`, '/static/js/<build>/')

function check(file: string, rendered: string): void {
  const actual = normalize(rendered)
  const path = join(snapshotDir, file)
  if (update) {
    mkdirSync(snapshotDir, { recursive: true })
    writeFileSync(path, actual)
    return
  }
  let expected: string
  try {
    expected = readFileSync(path, 'utf8')
  } catch {
    assert.fail(`Missing snapshot ${file}; run UPDATE_SNAPSHOTS=1 npm test to create it`)
  }
  assert.equal(actual, expected, `${file} differs from its snapshot`)
}

for (const page of pages()) {
  test(`snapshot: ${page.name}`, () => {
    const [html, markdown] = withFixedEnv(() =>
      runWithPageContext({ ...page.context }, () => [page.html?.(), page.markdown?.()]),
    )
    if (html !== undefined) {
      check(`${page.name}.html`, html)
    }
    if (markdown !== undefined) {
      check(`${page.name}.md`, markdown)
    }
  })
}
