import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.ts'
import { validate } from '../middleware/validate.ts'
import { addBlurt } from './state.ts'

export const blurtsRouter = Router()

const blurtSchema = z.object({
  text: z.string().trim().min(1, 'Blurt is required').max(280, 'Blurt is too long'),
})

blurtsRouter.post('/blurts', requireAuth, validate(blurtSchema), (request, response) => {
  const { text } = request.body as z.infer<typeof blurtSchema>
  addBlurt(response.locals.authenticatedUser.username, text)
  response.redirect(303, '/')
})
