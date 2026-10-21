import { Router, type Request } from 'express'
import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'
import {
  clearSessionCookies,
  countActiveSessions,
  endAllSessions,
  endDeletedAccountSessions,
  endSession,
  getViewer,
  requireAuth,
  startSession,
} from '../middleware/auth.ts'
import { accountKey, rateLimit, sendTooManyRequests, take } from '../middleware/rate-limit.ts'
import {
  inviteCodeMaxLength,
  passwordMaxLength,
  passwordMinLength,
  usernameMaxLength,
} from '../limits.ts'
import { fieldErrors, represent, sendError, sendFormErrors, sendFormSuccess } from '../negotiate.ts'
import {
  addUser,
  countWaiting,
  deleteAccount,
  getSignupState,
  getUserByUsername,
  getWaitlistEntry,
  isUsernameRetired,
  joinWaitlist,
  normalizeInviteCode,
  type SignupState,
} from './state.ts'
import {
  renderCreateUserPage,
  renderDeleteAccountPage,
  renderLoginPage,
  renderSettingsPage,
  renderWaitlistPage,
  type WaitlistData,
} from '../templates/index.ts'
import {
  createUserMarkdown,
  deleteAccountMarkdown,
  loginMarkdown,
  settingsMarkdown,
  waitlistMarkdown,
} from '../templates/pages.md.ts'

export const usersRouter = Router()

// Profiles live at /:username/, so a username must never equal a top-level path.
// Every top-level route must be listed here (test/users.test.ts fails otherwise), plus names
// we're likely to want for future pages. A POST shares its path with its GET page; POSTs
// without a page live under /api/, so new actions never need a new entry.
// Compared in lower case: Express routes ignore case.
export const reservedUsernames = new Set([
  // current routes
  'about',
  'admin',
  'api',
  'createuser',
  'debug', // /debug/og, the share card previews
  'deleted', // /deleted/:id, a deleted blurt's placeholder
  'everyone',
  'healthz',
  'login',
  'near',
  'og', // /og/:file, the share card images
  'pictures', // /pictures/:file, the drawings of blurt pictures
  'privacy',
  'robots.txt',
  'robots',
  'search',
  'settings',
  'sitemap.xml',
  'static',
  'terms',
  // likely future pages
  'account',
  'assets',
  'discover',
  'explore',
  'feed',
  'followers',
  'following',
  'help',
  'home',
  'invite',
  'invites',
  'logout',
  'messages',
  'notifications',
  'public',
  'register',
  'signup',
  'vendor',
  'waitlist',
])

const password = z
  .string()
  .min(passwordMinLength, `Password must be at least ${passwordMinLength} characters`)
  .max(passwordMaxLength, 'Password is too long')

const newUsername = z
  .string()
  .trim()
  .min(1, 'Username is required')
  .max(usernameMaxLength, 'Username is too long')
  .regex(/^[A-Za-z0-9_]+$/, 'Username can only contain letters, numbers and underscores')
  .refine((name) => !reservedUsernames.has(name.toLowerCase()), 'That username is reserved')

const invalidInviteCode = "That invite code doesn't exist, has been used or has expired"

// Optional: needed only once sign-up is invite-only. Empty counts as no code.
const inviteCode = z
  .string()
  .optional()
  .transform((value, context) => {
    if (!value?.trim()) {
      return undefined
    }
    const code = normalizeInviteCode(value)
    if (!code) {
      context.addIssue({ code: 'custom', message: invalidInviteCode })
      return z.NEVER
    }
    return code
  })

// The form sends a second password plus a "skip" checkbox; API clients may leave both out.
// The repeat must match unless it's skipped.
// "Keep me logged in": a checkbox sends `remember=1`, JSON callers may send true. Anything
// else, including "false" and "0", is a session-only login.
const remember = z
  .unknown()
  .optional()
  .transform((value) => value === true || value === '1' || value === 'true' || value === 'on')

const createUserSchema = z
  .object({
    username: newUsername,
    password,
    passwordConfirm: z.string().optional(),
    skipConfirm: z.unknown().optional(),
    remember,
    inviteCode,
  })
  .superRefine((data, context) => {
    const skipped = Boolean(data.skipConfirm) && data.skipConfirm !== 'false'
    if (data.passwordConfirm !== undefined && !skipped && data.passwordConfirm !== data.password) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirm'],
        message: "The passwords don't match",
      })
    }
  })

const waitlistSchema = z.object({ username: newUsername })

// Login only checks the shape; the database decides whether the user exists.
const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Username is required')
    .max(usernameMaxLength, 'Username is too long'),
  password,
  remember,
})

function submittedUsername(body: unknown): string {
  const username = (body as { username?: unknown } | undefined)?.username
  return typeof username === 'string' ? username : ''
}

function submittedInviteCode(body: unknown): string {
  const code = (body as { inviteCode?: unknown } | undefined)?.inviteCode
  return typeof code === 'string' ? code : ''
}

// Why sign-up was refused, for each state where it is closed to a plain sign-up.
const signupClosedMessages: Record<SignupState, string> = {
  open: 'Sign-up just changed. Please try again.', // the limits were raised mid-request
  invite: 'blurt.trade is invite-only right now. You need an invite code to sign up.',
  waitlist: 'Sign-up is full right now. Join the waitlist instead.',
}

// ?invite=<code> fills in the invite code, so a shared link is all an invitee needs.
usersRouter.get('/createUser', async (request, response) => {
  const invite = typeof request.query.invite === 'string' ? request.query.invite.trim() : ''
  if (invite.length > inviteCodeMaxLength) {
    sendError(request, response, 400, 'Invite code is too long', 'invite')
    return
  }
  represent(
    request,
    response,
    { viewer: getViewer(request), signup: await getSignupState(), inviteCode: invite || null },
    { html: renderCreateUserPage, markdown: createUserMarkdown },
  )
})

usersRouter.get('/login', async (request, response) => {
  represent(
    request,
    response,
    { viewer: getViewer(request) },
    { html: () => renderLoginPage(), markdown: loginMarkdown },
  )
})

usersRouter.post('/createUser', rateLimit('createUserIp'), async (request, response) => {
  const result = createUserSchema.safeParse(request.body ?? {})
  const rerender = async (validationError: string) =>
    renderCreateUserPage({
      viewer: getViewer(request),
      signup: await getSignupState(),
      inviteCode: submittedInviteCode(request.body) || null,
      username: submittedUsername(request.body),
      validationError,
    })
  if (!result.success) {
    await sendFormErrors(request, response, fieldErrors(result.error), rerender)
    return
  }

  // Hashed before claiming a slot, so the slot's row lock is held as briefly as possible.
  const { username, password, inviteCode, remember: keep } = result.data
  const user = await addUser(username, await hash(password), inviteCode)
  if (user === 'taken') {
    const errors = [{ field: 'username', message: 'Username is already taken' }]
    await sendFormErrors(request, response, errors, rerender)
    return
  }
  if (user === 'invalid-code') {
    const errors = [{ field: 'inviteCode', message: invalidInviteCode }]
    await sendFormErrors(request, response, errors, rerender)
    return
  }
  if (user === 'full') {
    const errors = [{ message: signupClosedMessages[await getSignupState()] }]
    await sendFormErrors(request, response, errors, rerender, 403)
    return
  }

  await startSession(request, response, user, keep)
  sendFormSuccess(request, response, {
    redirect: '/',
    data: { id: user.id, username: user.username },
    status: 201,
    location: `/${user.username}/`,
  })
})

// Limited per IP for every attempt, and per username for failed ones only, so guessing one
// account's password from many addresses is slow too, while its owner logging in doesn't
// count.
usersRouter.post('/login', rateLimit('loginIp'), async (request, response) => {
  const result = loginSchema.safeParse(request.body ?? {})
  const rerender = (validationError: string) =>
    renderLoginPage({ username: submittedUsername(request.body), validationError })
  if (!result.success) {
    await sendFormErrors(request, response, fieldErrors(result.error), rerender)
    return
  }

  const { username, password, remember: keep } = result.data
  const attempt = take('loginUsername', username.toLowerCase())
  if (!attempt.allowed) {
    sendTooManyRequests(request, response, attempt.retryAfterSeconds)
    return
  }
  const user = await getUserByUsername(username)
  if (!user || !(await verify(user.passwordHash, password))) {
    await sendFormErrors(request, response, [{ message: 'Invalid username or password' }], rerender)
    return
  }
  attempt.refund()

  await startSession(request, response, user, keep)
  sendFormSuccess(request, response, {
    redirect: '/',
    data: { id: user.id, username: user.username },
  })
})

usersRouter.post('/api/logout', async (request, response) => {
  await endSession(request, response)
  sendFormSuccess(request, response, { redirect: '/' })
})

usersRouter.get('/settings', requireAuth, async (request, response) => {
  const viewer = response.locals.authenticatedUser
  represent(
    request,
    response,
    { viewer, activeSessions: await countActiveSessions(viewer.id) },
    { html: renderSettingsPage, markdown: settingsMarkdown },
  )
})

// Logs the user out on every browser and device, this one included.
usersRouter.post('/api/logout-everywhere', requireAuth, async (request, response) => {
  await endAllSessions(response.locals.authenticatedUser.id, response)
  sendFormSuccess(request, response, { redirect: '/login' })
})

// Account deletion: a confirmation page that asks for the password again, since there is
// no other way to be sure it's the owner (no email, no password reset). The deletion
// itself is deleteAccount in src/routes/state.ts.
const deleteAccountSchema = z.object({
  password: z
    .string()
    .min(1, 'Password is required')
    .max(passwordMaxLength, 'Password is too long'),
})

usersRouter.get('/settings/delete', requireAuth, (request, response) => {
  represent(
    request,
    response,
    { viewer: response.locals.authenticatedUser },
    { html: (data) => renderDeleteAccountPage(data), markdown: deleteAccountMarkdown },
  )
})

usersRouter.post(
  '/settings/delete',
  requireAuth,
  rateLimit('deleteAccount', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const rerender = (validationError: string) =>
      renderDeleteAccountPage({ viewer }, validationError)
    const result = deleteAccountSchema.safeParse(request.body ?? {})
    if (!result.success) {
      await sendFormErrors(request, response, fieldErrors(result.error), rerender)
      return
    }

    const user = await getUserByUsername(viewer.username)
    if (!user || user.id !== viewer.id) {
      clearSessionCookies(response) // a still-valid token for an account that is gone
      sendError(request, response, 401, 'Authentication required')
      return
    }
    if (!(await verify(user.passwordHash, result.data.password))) {
      const errors = [
        { field: 'password', message: 'Wrong password. Your account was not deleted.' },
      ]
      await sendFormErrors(request, response, errors, rerender)
      return
    }

    const sessionIds = (await deleteAccount(user.id)) ?? []
    endDeletedAccountSessions(sessionIds, response)
    sendFormSuccess(request, response, { redirect: '/' })
  },
)

// Once sign-up is full, people leave the username they'd like here and check back on this
// page, with ?username=, which also says when sign-up has opened again. No email, so
// nobody is contacted. See db/migrations/*_signup-limits.sql.
async function getWaitlistData(request: Request, username: string | null): Promise<WaitlistData> {
  return {
    viewer: getViewer(request),
    signup: await getSignupState(),
    waiting: await countWaiting(),
    username,
    entry: (username && (await getWaitlistEntry(username))) || null,
  }
}

usersRouter.get('/waitlist', async (request, response) => {
  const username = typeof request.query.username === 'string' ? request.query.username.trim() : ''
  if (username.length > usernameMaxLength) {
    sendError(request, response, 400, 'Username is too long', 'username')
    return
  }
  represent(request, response, await getWaitlistData(request, username || null), {
    html: (data) => renderWaitlistPage(data),
    markdown: waitlistMarkdown,
  })
})

usersRouter.post('/waitlist', rateLimit('waitlistIp'), async (request, response) => {
  const result = waitlistSchema.safeParse(request.body ?? {})
  const rerender = async (validationError: string) =>
    renderWaitlistPage(await getWaitlistData(request, null), {
      username: submittedUsername(request.body),
      validationError,
    })
  if (!result.success) {
    await sendFormErrors(request, response, fieldErrors(result.error), rerender)
    return
  }

  const signup = await getSignupState()
  if (signup !== 'waitlist') {
    const message =
      signup === 'open'
        ? 'Sign-up is open, so there is no waitlist. Create a profile instead.'
        : signupClosedMessages.invite
    await sendFormErrors(request, response, [{ message }], rerender, 403)
    return
  }

  const { username } = result.data
  if ((await getUserByUsername(username)) || (await isUsernameRetired(username))) {
    const errors = [{ field: 'username', message: 'Username is already taken' }]
    await sendFormErrors(request, response, errors, rerender)
    return
  }

  const entry = await joinWaitlist(username)
  const location = `/waitlist?username=${encodeURIComponent(entry.username)}`
  sendFormSuccess(request, response, { redirect: location, data: entry, status: 201, location })
})
