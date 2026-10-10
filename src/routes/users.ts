import { Router } from 'express'
import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'
import { createAccessToken, setAccessToken } from '../middleware/auth.ts'
import { validate } from '../middleware/validate.ts'
import { addUser, users } from './state.ts'
import { renderCreateUserPage, renderLoginPage } from '../templates/index.ts'

export const usersRouter = Router()

const userSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(40, 'Username is too long'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200, 'Password is too long'),
})

const loginSchema = userSchema

usersRouter.get('/createUser', (_request, response) => {
  response.type('html').send(renderCreateUserPage())
})

usersRouter.post('/createUser', validate(userSchema), async (request, response, next) => {
  const { username, password } = request.body as z.infer<typeof userSchema>

  if (users.some((user) => user.username === username)) {
    response
      .status(400)
      .type('html')
      .send(renderCreateUserPage({ username, validationError: 'Username is already taken' }))
    return
  }

  try {
    const user = addUser(username, await hash(password))
    setAccessToken(response, await createAccessToken(user))
    response.redirect(303, '/')
  } catch (error) {
    next(error)
  }
})
import { clearAccessToken } from '../middleware/auth.ts'

usersRouter.get('/login', (_request, response) => {
  response.type('html').send(renderLoginPage())
})

usersRouter.get('/logout', (_request, response) => {
  clearAccessToken(response)
  response.redirect(303, '/')
})
usersRouter.post('/login', validate(loginSchema), async (request, response, next) => {
  const { username, password } = request.body as z.infer<typeof loginSchema>
  const user = users.find((candidate) => candidate.username === username)

  try {
    if (!user || !(await verify(user.passwordHash, password))) {
      response
        .status(400)
        .type('html')
        .send(renderLoginPage({ username, validationError: 'Invalid username or password' }))
      return
    }

    setAccessToken(response, await createAccessToken(user))
    response.redirect(303, '/')
  } catch (error) {
    next(error)
  }
})
