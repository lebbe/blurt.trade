import { Router } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { represent, sendError } from '../negotiate.ts'
import { charLength, searchQueryMaxLength } from '../limits.ts'
import { markViewerFlags, parseCursor, searchBlurts, searchUsers } from './state.ts'
import { renderSearchPage, type SearchData } from '../templates/index.ts'
import { searchMarkdown } from '../templates/pages.md.ts'

export const searchRouter = Router()

// ?q= as the search box sends it. Anything that isn't one string (missing, ?q[]=, ?q=a&q=b)
// is an empty search: a friendly page, not an error. Control characters (a NUL would make
// Postgres fail) become spaces. Undefined when it is over the length limit.
export function parseSearchQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return ''
  }
  const query = value.replace(/\p{Cc}/gu, ' ').trim()
  return charLength(query) <= searchQueryMaxLength ? query : undefined
}

// Usernames and blurt text. The query is never logged: request lines leave out the query
// string (src/logging.ts). Users come only on the first page; `before` pages the blurts.
searchRouter.get('/search', rateLimit('search'), async (request, response) => {
  const query = parseSearchQuery(request.query.q)
  if (query === undefined) {
    sendError(
      request,
      response,
      400,
      `Search is too long (at most ${searchQueryMaxLength} characters)`,
      'q',
    )
    return
  }
  const before = parseCursor(request.query.before)
  if (before === undefined) {
    sendError(request, response, 400, 'Invalid cursor', 'before')
    return
  }

  const viewer = getViewer(request)
  const username = query.replace(/^@/, '')
  const [users, { items: blurts, next }] = await Promise.all([
    username !== '' && before === null ? searchUsers(username) : [],
    query !== '' ? searchBlurts(query, before) : { items: [], next: null },
  ])
  await markViewerFlags(viewer?.id ?? null, blurts)
  const data: SearchData = { viewer, query, users, blurts, next }
  await represent(request, response, data, { html: renderSearchPage, markdown: searchMarkdown })
})
