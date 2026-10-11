import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuthenticatedUser } from './middleware/auth.ts'
import { defaultTheme, type ThemeId } from './themes.ts'

// What every page's frame needs from the request, whatever the route: who is looking (for
// the navigation), which page they are on (to mark it in the navigation) and their theme.
// Set once per request by the pageContext middleware (src/server.ts), so routes and error
// handlers can render pages without passing it along.
export type PageContext = {
  viewer: AuthenticatedUser | null
  path: string
  theme: ThemeId
}

const storage = new AsyncLocalStorage<PageContext>()

const outside: PageContext = { viewer: null, path: '', theme: defaultTheme }

export function runWithPageContext<T>(context: PageContext, callback: () => T): T {
  return storage.run(context, callback)
}

// Outside a request (or before the middleware ran, e.g. a malformed body): anonymous, the
// default theme and no page marked.
export function pageContext(): PageContext {
  return storage.getStore() ?? outside
}
