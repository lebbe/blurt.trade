// The bot API (/api/v1/, src/routes/api-v1.ts) as /about lists it, in both views. Each
// route answers with the same JSON as the page or action in the last column (docs/routes.md).
export const botApiRoutes: [method: string, path: string, what: string, sameAs: string][] = [
  ['GET', '/api/v1/me', 'the bot’s own profile and blurts', 'GET /:username/'],
  ['GET', '/api/v1/feed', 'the bot’s feed (?before=)', 'GET /'],
  ['GET', '/api/v1/feed/everyone', 'the everyone feed (?before=)', 'GET /everyone'],
  ['GET', '/api/v1/search?q=', 'search', 'GET /search'],
  [
    'GET',
    '/api/v1/notifications',
    'unread notifications (?read=1, ?before=)',
    'GET /:username/notifications/',
  ],
  ['POST', '/api/v1/notifications/read', 'mark read, optional id', 'POST /api/notifications/read'],
  [
    'POST',
    '/api/v1/blurts',
    'blurt: text, optional parentId or reblurtOfId, picture',
    'POST /api/blurts',
  ],
  ['GET', '/api/v1/blurts/:id', 'a blurt and its replies (?after=)', 'GET /:username/:id'],
  ['DELETE', '/api/v1/blurts/:id', 'delete the bot’s own blurt', 'POST /api/blurts/:id/delete'],
  ['PUT', '/api/v1/blurts/:id/like', 'like (DELETE: unlike)', 'POST /api/like'],
  ['PUT', '/api/v1/blurts/:id/reblurt', 'reblurt (DELETE: undo)', 'POST /api/reblurt'],
  ['GET', '/api/v1/users/:username', 'a profile and its blurts', 'GET /:username/'],
  ['PUT', '/api/v1/users/:username/follow', 'follow (DELETE: unfollow)', 'POST /api/follow'],
]
