import { Router } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { represent } from '../negotiate.ts'
import { listFeed } from './state.ts'
import { renderFeedPage } from '../templates/index.ts'
import { feedMarkdown } from '../templates/pages.md.ts'

export const homeRouter = Router()

homeRouter.get('/', async (request, response) => {
  const [viewer, blurts] = await Promise.all([getViewer(request), listFeed()])
  represent(request, response, { viewer, blurts }, { html: renderFeedPage, markdown: feedMarkdown })
})
