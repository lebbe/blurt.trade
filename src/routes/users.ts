import { Router, type Request } from 'express'
import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'
import {
  countActiveSessions,
  endAllSessions,
  endSession,
  getViewer,
  requireAuth,
  startSession,
} from '../middleware/auth.ts'
import { rateLimit, sendTooManyRequests, take } from '../middleware/rate-limit.ts'
import { fieldErrors, represent, sendFormErrors, sendFormSuccess } from '../negotiate.ts'
import {
  addUser,
  countWaiting,
  getSignupState,
  getUserByUsername,
  getWaitlistEntry,
  joinWaitlist,
  normalizeInviteCode,
  type SignupState,
} from './state.ts'
import {
  renderCreateUserPage,
  renderLoginPage,
  renderSettingsPage,
  renderWaitlistPage,
  type WaitlistData,
} from '../templates/index.ts'
import {
  createUserMarkdown,
  loginMarkdown,
  settingsMarkdown,
  waitlistMarkdown,
} from '../templates/pages.md.ts'

export const usersRouter = Router()

// Profiles live at /:username/, so a username must never equal a top-level path.
// Every top-level route must be listed here (app.test.ts fails otherwise), plus names
// we're likely to want for future pages. A POST shares its path with its GET page; POSTs
// without a page live under /api/, so new actions never need a new entry.
// Compared in lower case: Express routes ignore case.
export const reservedUsernames = new Set([
  // current routes
  'admin',
  'api',
  'createuser',
  'deleted', // /deleted/:id, a deleted blurt's placeholder
  'everyone',
  'login',
  'near',
  'settings',
  'static',
  // likely future pages
  'about',
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
  'privacy',
  'public',
  'register',
  'search',
  'signup',
  'terms',
  'vendor',
  'waitlist',
])

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long')

const newUsername = z
  .string()
  .trim()
  .min(1, 'Username is required')
  .max(40, 'Username is too long')
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

const createUserSchema = z.object({ username: newUsername, password, inviteCode })

const waitlistSchema = z.object({ username: newUsername })

// Login only checks the shape; the database decides whether the user exists.
const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(40, 'Username is too long'),
  password,
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
  const { username, password, inviteCode } = result.data
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

  await startSession(request, response, user)
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

  const { username, password } = result.data
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

  await startSession(request, response, user)
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
  const username = typeof request.query.username === 'string' ? request.query.username : ''
  represent(request, response, await getWaitlistData(request, username.trim() || null), {
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
  if (await getUserByUsername(username)) {
    const errors = [{ field: 'username', message: 'Username is already taken' }]
    await sendFormErrors(request, response, errors, rerender)
    return
  }

  const entry = await joinWaitlist(username)
  const location = `/waitlist?username=${encodeURIComponent(entry.username)}`
  sendFormSuccess(request, response, { redirect: location, data: entry, status: 201, location })
})
