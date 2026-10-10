import { Router } from 'express'
import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'
import { clearAccessToken, createAccessToken, setAccessToken } from '../middleware/auth.ts'
import { validate } from '../middleware/validate.ts'
import { addUser, getUserByUsername } from './state.ts'
import { renderCreateUserPage, renderLoginPage } from '../templates/index.ts'

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
  'login',
  // likely future pages
  'about',
  'account',
  'admin',
  'assets',
  'discover',
  'explore',
  'feed',
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

usersRouter.get('/createUser', (_request, response) => {
  response.type('html').send(renderCreateUserPage())
})

usersRouter.get('/login', (_request, response) => {
  response.type('html').send(renderLoginPage())
})

usersRouter.post('/createUser', validate(createUserSchema), async (request, response) => {
  const { username, password } = request.body as z.infer<typeof createUserSchema>

  const user = await addUser(username, await hash(password))
  if (!user) {
    response
      .status(400)
      .type('html')
      .send(renderCreateUserPage({ username, validationError: 'Username is already taken' }))
    return
  }

  setAccessToken(response, await createAccessToken(user))
  response.redirect(303, '/')
})

usersRouter.post('/login', validate(loginSchema), async (request, response) => {
  const { username, password } = request.body as z.infer<typeof loginSchema>

  const user = await getUserByUsername(username)
  if (!user || !(await verify(user.passwordHash, password))) {
    response
      .status(400)
      .type('html')
      .send(renderLoginPage({ username, validationError: 'Invalid username or password' }))
    return
  }

  setAccessToken(response, await createAccessToken(user))
  response.redirect(303, '/')
})

usersRouter.post('/api/logout', (_request, response) => {
  clearAccessToken(response)
  response.redirect(303, '/')
})
