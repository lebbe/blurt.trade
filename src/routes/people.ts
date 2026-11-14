import { Router } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { represent, sendError } from '../negotiate.ts'
import { listPeople, parsePeopleCursor } from './state.ts'
import { renderPeoplePage } from '../pages/people/people.html.ts'
import { peopleMarkdown } from '../pages/people/people.md.ts'

export const peopleRouter = Router()

// Everyone with a live account, alphabetically, `after` being the last username of the
// previous page.
peopleRouter.get('/people', async (request, response) => {
  const after = parsePeopleCursor(request.query.after)
  if (after === undefined) {
    sendError(request, response, 400, 'Invalid cursor', 'after')
    return
  }

  const { items: people, next } = await listPeople(after)
  await represent(
    request,
    response,
    { viewer: getViewer(request), people, next },
    { html: renderPeoplePage, markdown: peopleMarkdown },
  )
})
