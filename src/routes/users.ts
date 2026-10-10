import { Router } from 'express'
import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'
import {
  clearAccessToken,
  createAccessToken,
  getViewer,
  setAccessToken,
} from '../middleware/auth.ts'
import { fieldErrors, represent, sendFormErrors, sendFormSuccess } from '../negotiate.ts'
import { addUser, getUserByUsername } from './state.ts'
import { renderCreateUserPage, renderLoginPage } from '../templates/index.ts'
import { createUserMarkdown, loginMarkdown } from '../templates/pages.md.ts'

export const usersRouter = Router()

// Profiles live at /:username/, so a username must never equal a top-level path.
// Every top-level route must be listed here (app.test.ts fails otherwise), plus names
// we're likely to want for future pages. A POST shares its path with its GET page; POSTs
// without a page live under /api/, so new actions never need a new entry.
// Compared in lower case: Express routes ignore case.
export const reservedUsernames = new Set([
  // current routes
  'api',
  'createuser',
  'everyone',
  'login',
  // likely future pages
  'about',
  'account',
  'admin',
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
  'settings',
  'signup',
  'static',
  'terms',
  'vendor',
  'waitlist',
])

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long')

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Username is required')
    .max(40, 'Username is too long')
    .regex(/^[A-Za-z0-9_]+$/, 'Username can only contain letters, numbers and underscores')
    .refine((name) => !reservedUsernames.has(name.toLowerCase()), 'That username is reserved'),
  password,
})

// Login only checks the shape; the database decides whether the user exists.
const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(40, 'Username is too long'),
  password,
})

function submittedUsername(body: unknown): string {
  const username = (body as { username?: unknown } | undefined)?.username
  return typeof username === 'string' ? username : ''
}

usersRouter.get('/createUser', async (request, response) => {
  represent(
    request,
    response,
    { viewer: await getViewer(request) },
    { html: () => renderCreateUserPage(), markdown: createUserMarkdown },
  )
})

usersRouter.get('/login', async (request, response) => {
  represent(
    request,
    response,
    { viewer: await getViewer(request) },
    { html: () => renderLoginPage(), markdown: loginMarkdown },
  )
})

usersRouter.post('/createUser', async (request, response) => {
  const result = createUserSchema.safeParse(request.body ?? {})
  const rerender = (validationError: string) =>
    renderCreateUserPage({ username: submittedUsername(request.body), validationError })
  if (!result.success) {
    await sendFormErrors(request, response, fieldErrors(result.error), rerender)
    return
  }

  const { username, password } = result.data
  const user = await addUser(username, await hash(password))
  if (!user) {
    const errors = [{ field: 'username', message: 'Username is already taken' }]
    await sendFormErrors(request, response, errors, rerender)
    return
  }

  setAccessToken(response, await createAccessToken(user))
  sendFormSuccess(request, response, {
    redirect: '/',
    data: { id: user.id, username: user.username },
    status: 201,
    location: `/${user.username}/`,
  })
})

usersRouter.post('/login', async (request, response) => {
  const result = loginSchema.safeParse(request.body ?? {})
  const rerender = (validationError: string) =>
    renderLoginPage({ username: submittedUsername(request.body), validationError })
  if (!result.success) {
    await sendFormErrors(request, response, fieldErrors(result.error), rerender)
    return
  }

  const { username, password } = result.data
  const user = await getUserByUsername(username)
  if (!user || !(await verify(user.passwordHash, password))) {
    await sendFormErrors(request, response, [{ message: 'Invalid username or password' }], rerender)
    return
  }

  setAccessToken(response, await createAccessToken(user))
  sendFormSuccess(request, response, {
    redirect: '/',
    data: { id: user.id, username: user.username },
  })
})

usersRouter.post('/api/logout', (request, response) => {
  clearAccessToken(response)
  sendFormSuccess(request, response, { redirect: '/' })
})
