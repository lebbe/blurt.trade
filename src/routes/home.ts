import { Router } from 'express'
import { getAuthenticatedUser, readAccessToken } from '../middleware/auth.ts'
import { listFeed, type FeedItem } from './state.ts'
import { renderFeedPage } from '../templates/index.ts'

export const homeRouter = Router()

function escapeMarkdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replace(/[\\`*_[\]{}()#+\-.!>]/g, '\\$&')
}

function renderFeedMarkdown(blurts: FeedItem[]): string {
  const feed = blurts.map((blurt) => {
    return [
      `### ${escapeMarkdown(blurt.username)}`,
      `_${blurt.createdAt.toISOString()}_`,
      '',
      escapeMarkdown(blurt.text),
      ...blurt.replies.map(
        (reply) => `\n> **${escapeMarkdown(reply.username)}**: ${escapeMarkdown(reply.text)}`,
      ),
    ].join('\n')
  })

  return [
    '# blurt.trade',
    '',
    'Say the thing. Regret it later.',
    '',
    '## Feed',
    '',
    feed.length > 0 ? feed.join('\n\n') : 'Nothing has been blurted yet.',
    '',
  ].join('\n')
}

homeRouter.get('/', async (request, response) => {
  const representation = request.accepts(['html', 'json', 'text/plain'])
  const blurts = await listFeed()

  if (representation === 'json') {
    response.json(blurts)
    return
  }

  if (representation === 'html') {
    const user = await getAuthenticatedUser(readAccessToken(request.headers.cookie))
    response.type('html').send(renderFeedPage(blurts, undefined, Boolean(user)))
    return
  }

  if (representation === 'text/plain') {
    response.type('text/plain').send(renderFeedMarkdown(blurts))
    return
  }

  response.status(406).send('Not Acceptable')
})
