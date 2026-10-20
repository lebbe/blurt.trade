import { Router } from 'express'
import { sendError } from '../negotiate.ts'
import { pictureSvg } from '../picture.ts'
import { getPictureShapes } from './state.ts'

export const picturesRouter = Router()

// The drawing of a blurt's picture, as SVG. No auth: like the blurt, it is public.
picturesRouter.get('/pictures/:file', async (request, response) => {
  const match = /^(\d{1,15})\.svg$/.exec(request.params.file)
  const shapes = match ? await getPictureShapes(Number(match[1])) : undefined
  if (!shapes) {
    sendError(request, response, 404, 'Not found')
    return
  }
  response
    .set('Cache-Control', 'public, max-age=86400')
    .type('image/svg+xml')
    .send(pictureSvg(shapes))
})
